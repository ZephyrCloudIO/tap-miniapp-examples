import {
  ApiError,
  allowedRequestPatterns,
  type BrowserEngine,
  type SessionInput,
  type SnapshotInput,
  validateTargetUrl,
} from "./policy";

export interface UpstreamSessionDescriptor {
  readonly upstreamSessionId: string;
  readonly targetId: string;
  readonly liveViewUrl: string;
}

export interface RefreshedBrowserTarget {
  readonly targetId: string;
  readonly liveViewUrl: string;
}

export type BrowserCloseStatus = "closing" | "closed";

type BrowserEnv = Pick<Env, "BROWSER">;

interface BrowserRunActionBody {
  readonly url: string;
  readonly gotoOptions: {
    readonly waitUntil: SnapshotInput["waitUntil"];
    readonly timeout: number;
  };
  readonly actionTimeout: number;
  readonly allowRequestPattern: readonly string[];
}

interface BrowserRunSessionGuardrails {
  readonly allowedDomains: readonly string[];
}

interface BrowserRunTarget {
  readonly id: string;
  readonly url: string;
  readonly devtoolsFrontendUrl: string;
}

const SESSION_RESPONSE_LIMIT = 256 * 1024;
const SCREENSHOT_ACTION_RESPONSE_LIMIT = 6 * 1024 * 1024;
const CONTENT_ACTION_RESPONSE_LIMIT = 4 * 1024 * 1024;
const MARKDOWN_ACTION_RESPONSE_LIMIT = 2 * 1024 * 1024;
const ACCESSIBILITY_ACTION_RESPONSE_LIMIT = 2 * 1024 * 1024;
const SNAPSHOT_RESPONSE_LIMIT = 10 * 1024 * 1024;
const SNAPSHOT_ACTION_CONCURRENCY = 2;
const LIVE_VIEW_ORIGIN = "https://live.browser.run";
const MAX_LIVE_VIEW_URL_LENGTH = 8 * 1024;
const UPSTREAM_IDENTIFIER = /^[0-9A-Za-z._:-]{1,128}$/u;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

const BROWSER_BINDING_ORIGIN = "https://browser.internal";
const BROWSER_BINDING_API = `${BROWSER_BINDING_ORIGIN}/v1`;

function browserHeaders(jsonBody = false): Headers {
  const headers = new Headers();
  if (jsonBody) headers.set("Content-Type", "application/json");
  return headers;
}

async function cancelResponseBody(
  response: Response,
  reason: string,
): Promise<void> {
  await response.body?.cancel(reason).catch(() => undefined);
}

async function requestBrowserRun(
  env: BrowserEnv,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await env.BROWSER.fetch(input, init);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Fetch errors may include the full request URL. Target URLs can contain
    // sensitive query data, so normalize before the error reaches logging.
    throw new ApiError(
      502,
      "browser_run_unavailable",
      "Browser Run is temporarily unavailable.",
    );
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > SESSION_RESPONSE_LIMIT) {
    await cancelResponseBody(response, "session response too large");
    throw new ApiError(
      502,
      "upstream_too_large",
      "Browser Run returned an oversized session response.",
    );
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > SESSION_RESPONSE_LIMIT) {
      await reader.cancel("session response too large");
      throw new ApiError(
        502,
        "upstream_too_large",
        "Browser Run returned an oversized session response.",
      );
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned invalid JSON.");
  }
}

async function readBoundedBytes(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    await cancelResponseBody(response, "evidence response too large");
    throw new ApiError(
      502,
      "upstream_too_large",
      "Browser Run returned oversized evidence.",
    );
  }
  if (!response.body) {
    throw new ApiError(502, "invalid_upstream", "Browser Run omitted evidence.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) {
      await reader.cancel("evidence response too large");
      throw new ApiError(
        502,
        "upstream_too_large",
        "Browser Run returned oversized evidence.",
      );
    }
    chunks.push(chunk.value);
  }
  if (size === 0) {
    throw new ApiError(502, "invalid_upstream", "Browser Run omitted evidence.");
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readSnapshotJson(
  response: Response,
  limit: number,
): Promise<unknown> {
  const bytes = await readBoundedBytes(response, limit);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned invalid JSON.");
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned an invalid object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const envelope = asRecord(value);
    if (envelope.result !== undefined) return envelope.result;
  }
  return value;
}

function requiredString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const item = value[key];
  if (typeof item !== "string" || !item) {
    throw new ApiError(502, "invalid_upstream", `Browser Run omitted ${key}.`);
  }
  return item;
}

function requiredIdentifier(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const item = requiredString(value, key);
  if (!UPSTREAM_IDENTIFIER.test(item)) {
    throw new ApiError(
      502,
      "invalid_upstream",
      `Browser Run returned an invalid ${key}.`,
    );
  }
  return item;
}

function parseLiveViewUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_LIVE_VIEW_URL_LENGTH
  ) {
    throw new ApiError(502, "invalid_upstream", "Browser Run omitted devtoolsFrontendUrl.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned an invalid Live View URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== LIVE_VIEW_ORIGIN ||
    url.username ||
    url.password
  ) {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned an untrusted Live View URL.");
  }
  return url.toString();
}

function parseTarget(
  value: unknown,
  allowedHosts: string,
  expectedInternalUrl: "about:blank" | null = null,
): BrowserRunTarget {
  const target = asRecord(unwrap(value));
  const targetUrl = requiredString(target, "url");
  if (targetUrl !== expectedInternalUrl) {
    try {
      validateTargetUrl(targetUrl, allowedHosts);
    } catch {
      throw new ApiError(
        502,
        "invalid_upstream",
        "Browser Run returned a target outside the configured egress policy.",
      );
    }
  }
  return {
    id: requiredIdentifier(target, "id"),
    url: targetUrl,
    devtoolsFrontendUrl: parseLiveViewUrl(target.devtoolsFrontendUrl),
  };
}

function findTarget(
  value: unknown,
  targetId: string,
  allowedHosts: string,
): BrowserRunTarget {
  const targets = unwrap(value);
  if (!Array.isArray(targets)) {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned an invalid target list.");
  }
  // Browser Run may include internal/non-page targets (for example `about:blank`)
  // in this list. Validate only the target we allocated and persist by ID.
  const candidate = targets.find((target) => {
    try {
      return requiredIdentifier(asRecord(target), "id") === targetId;
    } catch {
      return false;
    }
  });
  if (!candidate) {
    throw new ApiError(
      502,
      "browser_target_missing",
      "Browser Run no longer reports the session target.",
    );
  }
  return parseTarget(candidate, allowedHosts);
}

async function throwUpstream(response: Response): Promise<never> {
  let upstreamCode: string | number | null = null;
  try {
    const payload = asRecord(await readBoundedJson(response));
    const errors = payload.errors;
    if (Array.isArray(errors) && errors[0] && typeof errors[0] === "object") {
      const candidate = Reflect.get(errors[0], "code");
      if (
        (typeof candidate === "number" && Number.isFinite(candidate)) ||
        (typeof candidate === "string" && candidate.length <= 64)
      ) {
        upstreamCode = candidate;
      }
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === "upstream_too_large") throw error;
  }
  console.error(
    JSON.stringify({
      message: "Browser Run rejected a gateway request",
      upstreamStatus: response.status,
      upstreamCode,
    }),
  );
  throw new ApiError(
    502,
    "browser_run_failed",
    "Browser Run could not complete the request.",
  );
}

function applyEngineSelector(url: URL, engine: BrowserEngine): void {
  if (engine === "kitesurf") url.searchParams.set("browser", "kitesurf");
}

type SnapshotFormat = SnapshotInput["formats"][number];

interface SnapshotActionMeta {
  readonly title: string | null;
  readonly status: number | null;
}

interface SnapshotActionResult {
  readonly format: SnapshotFormat;
  readonly value: unknown;
  readonly meta: SnapshotActionMeta;
  readonly browserMs: number | null;
}

function browserTime(response: Response): number | null {
  const raw = response.headers.get("X-Browser-Ms-Used");
  if (raw === null || !/^(?:0|[1-9][0-9]*)$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function actionMeta(envelope: Readonly<Record<string, unknown>>): SnapshotActionMeta {
  if (envelope.meta === undefined) return { title: null, status: null };
  const meta = asRecord(envelope.meta);
  const title = meta.title;
  const status = meta.status;
  if (
    title !== undefined &&
    (typeof title !== "string" || title.length > 1_024)
  ) {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned an invalid page title.");
  }
  if (
    status !== undefined &&
    (!Number.isSafeInteger(status) || Number(status) < 100 || Number(status) > 599)
  ) {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned an invalid page status.");
  }
  return {
    title: typeof title === "string" ? title : null,
    status: typeof status === "number" ? status : null,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return globalThis.btoa(binary);
}

async function readScreenshotAction(response: Response): Promise<string> {
  const mediaType = response.headers.get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "image/png") {
    await cancelResponseBody(response, "unexpected screenshot media type");
    throw new ApiError(502, "invalid_upstream", "Browser Run returned a non-PNG screenshot.");
  }
  const bytes = await readBoundedBytes(
    response,
    SCREENSHOT_ACTION_RESPONSE_LIMIT,
  );
  if (
    bytes.byteLength < PNG_SIGNATURE.length ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned an invalid PNG screenshot.");
  }
  return bytesToBase64(bytes);
}

async function readJsonAction(
  response: Response,
  format: Exclude<SnapshotFormat, "screenshot">,
): Promise<{ readonly value: unknown; readonly meta: SnapshotActionMeta }> {
  const mediaType = response.headers.get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    await cancelResponseBody(response, "unexpected evidence media type");
    throw new ApiError(502, "invalid_upstream", "Browser Run returned non-JSON evidence.");
  }
  const limit = format === "content"
    ? CONTENT_ACTION_RESPONSE_LIMIT
    : format === "markdown"
      ? MARKDOWN_ACTION_RESPONSE_LIMIT
      : ACCESSIBILITY_ACTION_RESPONSE_LIMIT;
  const envelope = asRecord(await readSnapshotJson(response, limit));
  if (envelope.success !== true) {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned an invalid success envelope.");
  }
  const result = envelope.result;
  if (format === "accessibilityTree") {
    const tree = asRecord(result).accessibilityTree;
    if (!tree || typeof tree !== "object" || Array.isArray(tree)) {
      throw new ApiError(
        502,
        "invalid_upstream",
        "Browser Run omitted accessibilityTree evidence.",
      );
    }
    return { value: tree, meta: actionMeta(envelope) };
  }
  if (typeof result !== "string") {
    throw new ApiError(502, "invalid_upstream", `Browser Run omitted ${format} evidence.`);
  }
  return { value: result, meta: actionMeta(envelope) };
}

async function captureSnapshotAction(
  format: SnapshotFormat,
  input: SnapshotInput,
  body: BrowserRunActionBody,
  env: BrowserEnv,
): Promise<SnapshotActionResult> {
  const endpoint = new URL(`${BROWSER_BINDING_API}/${format}`);
  applyEngineSelector(endpoint, input.engine);
  endpoint.searchParams.set("cacheTTL", "0");
  const requestBody = format === "screenshot"
    ? {
        ...body,
        screenshotOptions: { type: "png", encoding: "binary" },
      }
    : body;
  const response = await requestBrowserRun(env, endpoint, {
    method: "POST",
    headers: browserHeaders(true),
    body: JSON.stringify(requestBody),
    redirect: "manual",
  });
  if (!response.ok) await throwUpstream(response);
  const used = browserTime(response);
  if (format === "screenshot") {
    return {
      format,
      value: await readScreenshotAction(response),
      meta: { title: null, status: null },
      browserMs: used,
    };
  }
  const evidence = await readJsonAction(response, format);
  return { format, value: evidence.value, meta: evidence.meta, browserMs: used };
}

function consistentValue<T>(
  values: readonly (T | null)[],
  label: string,
): T | null {
  const reported = values.filter((value): value is T => value !== null);
  if (reported.length === 0) return null;
  if (!reported.every((value) => Object.is(value, reported[0]))) {
    throw new ApiError(
      502,
      "inconsistent_upstream",
      `Browser Run returned inconsistent ${label} metadata.`,
    );
  }
  return reported[0] ?? null;
}

async function captureSnapshotActions(
  input: SnapshotInput,
  body: BrowserRunActionBody,
  env: BrowserEnv,
): Promise<readonly SnapshotActionResult[]> {
  const results: (SnapshotActionResult | undefined)[] = new Array(
    input.formats.length,
  );
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = nextIndex;
      nextIndex += 1;
      const format = input.formats[index];
      if (format === undefined) return;
      try {
        results[index] = await captureSnapshotAction(format, input, body, env);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(SNAPSHOT_ACTION_CONCURRENCY, input.formats.length) },
      () => worker(),
    ),
  );
  if (failed) throw failure;
  if (results.some((result) => result === undefined)) {
    throw new ApiError(
      502,
      "invalid_upstream",
      "Browser Run omitted a requested evidence action.",
    );
  }
  return results as SnapshotActionResult[];
}

async function cleanupFailedSessionAllocation(
  sessionId: string,
  env: BrowserEnv,
): Promise<void> {
  try {
    await releaseBrowserSession(sessionId, env);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "agent browser session cleanup failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function captureBrowserSnapshot(
  input: SnapshotInput,
  allowedHosts: string,
  env: BrowserEnv,
): Promise<Response> {
  const body: BrowserRunActionBody = {
    url: input.url,
    gotoOptions: {
      waitUntil: input.waitUntil,
      timeout: input.timeoutMs,
    },
    actionTimeout: Math.max(60_000, input.timeoutMs),
    allowRequestPattern: allowedRequestPatterns(allowedHosts),
  };
  const actions = await captureSnapshotActions(input, body, env);
  const result: Record<string, unknown> = {};
  for (const action of actions) result[action.format] = action.value;

  const title = consistentValue(actions.map(({ meta }) => meta.title), "title");
  const status = consistentValue(actions.map(({ meta }) => meta.status), "status");
  const meta: Record<string, unknown> = {
    formats: actions.map(({ format }) => format),
  };
  if (title !== null) meta.title = title;
  if (status !== null) meta.status = status;

  const serialized = JSON.stringify({ success: true, result, meta });
  if (new TextEncoder().encode(serialized).byteLength > SNAPSHOT_RESPONSE_LIMIT) {
    throw new ApiError(
      502,
      "upstream_too_large",
      "The combined Browser Run evidence exceeded the gateway limit.",
    );
  }
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  const browserTimes = actions.map(({ browserMs }) => browserMs);
  if (browserTimes.every((value): value is number => value !== null)) {
    const total = browserTimes.reduce((sum, value) => sum + value, 0);
    if (Number.isSafeInteger(total)) headers.set("X-Browser-Ms-Used", String(total));
  }
  return new Response(serialized, { status: 200, headers });
}

export async function createBrowserSession(
  input: SessionInput,
  allowedDomains: readonly string[],
  allowedHosts: string,
  browserRunInactivityTimeoutMs: number,
  env: BrowserEnv,
): Promise<UpstreamSessionDescriptor> {
  const acquireUrl = new URL(`${BROWSER_BINDING_API}/devtools/browser`);
  acquireUrl.searchParams.set(
    "keep_alive",
    String(browserRunInactivityTimeoutMs),
  );
  acquireUrl.searchParams.set("targets", "true");
  acquireUrl.searchParams.set(
    "liveViewUrlExpiresInMs",
    String(Math.min(input.keepAliveMs, 3_600_000)),
  );
  applyEngineSelector(acquireUrl, input.engine);
  const guardrails: BrowserRunSessionGuardrails = { allowedDomains };

  const acquired = await requestBrowserRun(env, acquireUrl, {
    method: "POST",
    headers: browserHeaders(true),
    body: JSON.stringify({ guardrails }),
    redirect: "manual",
  });
  if (!acquired.ok) await throwUpstream(acquired);
  const session = asRecord(unwrap(await readBoundedJson(acquired)));
  const upstreamSessionId = requiredIdentifier(session, "sessionId");

  const targetUrl = new URL(
    `${BROWSER_BINDING_API}/devtools/browser/${encodeURIComponent(upstreamSessionId)}/json/new`,
  );
  // Attach CDP and enable observability before the first real navigation. CDP
  // does not backfill requests, console entries, or exceptions emitted before
  // a client enables those domains.
  targetUrl.searchParams.set("url", "about:blank");
  targetUrl.searchParams.set(
    "liveViewUrlExpiresInMs",
    String(Math.min(input.keepAliveMs, 3_600_000)),
  );
  try {
    const targetResponse = await requestBrowserRun(env, targetUrl, {
      method: "PUT",
      headers: browserHeaders(),
      redirect: "manual",
    });
    if (!targetResponse.ok) await throwUpstream(targetResponse);
    const target = parseTarget(
      await readBoundedJson(targetResponse),
      allowedHosts,
      "about:blank",
    );
    return {
      upstreamSessionId,
      targetId: target.id,
      liveViewUrl: target.devtoolsFrontendUrl,
    };
  } catch (error) {
    await cleanupFailedSessionAllocation(upstreamSessionId, env);
    throw error;
  }
}

export async function refreshBrowserTarget(
  upstreamSessionId: string,
  targetId: string,
  liveViewExpiresInMs: number,
  allowedHosts: string,
  env: BrowserEnv,
): Promise<RefreshedBrowserTarget> {
  const endpoint = new URL(
    `${BROWSER_BINDING_API}/devtools/browser/${encodeURIComponent(upstreamSessionId)}/json/list`,
  );
  endpoint.searchParams.set(
    "liveViewUrlExpiresInMs",
    String(Math.min(Math.max(liveViewExpiresInMs, 60_000), 3_600_000)),
  );
  const response = await requestBrowserRun(env, endpoint, {
    headers: browserHeaders(),
    redirect: "manual",
  });
  if (!response.ok) await throwUpstream(response);
  const target = findTarget(await readBoundedJson(response), targetId, allowedHosts);
  return { targetId: target.id, liveViewUrl: target.devtoolsFrontendUrl };
}

export async function releaseBrowserSession(
  upstreamSessionId: string,
  env: BrowserEnv,
): Promise<BrowserCloseStatus> {
  const response = await requestBrowserRun(
    env,
    `${BROWSER_BINDING_API}/devtools/browser/${encodeURIComponent(upstreamSessionId)}`,
    {
      method: "DELETE",
      headers: browserHeaders(),
      redirect: "manual",
    },
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return "closed";
  }
  if (!response.ok) await throwUpstream(response);
  const payload = asRecord(unwrap(await readBoundedJson(response)));
  const status = payload.status;
  if (status !== "closing" && status !== "closed") {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned an invalid close status.");
  }
  return status;
}

export async function browserSessionIsClosed(
  upstreamSessionId: string,
  env: BrowserEnv,
): Promise<boolean> {
  const response = await requestBrowserRun(
    env,
    `${BROWSER_BINDING_API}/devtools/session/${encodeURIComponent(upstreamSessionId)}`,
    { headers: browserHeaders(), redirect: "manual" },
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return true;
  }
  if (!response.ok) await throwUpstream(response);
  const session = asRecord(unwrap(await readBoundedJson(response)));
  if (requiredIdentifier(session, "sessionId") !== upstreamSessionId) {
    throw new ApiError(502, "invalid_upstream", "Browser Run returned the wrong session.");
  }
  return (
    (typeof session.endTime === "number" &&
      Number.isFinite(session.endTime) &&
      session.endTime > 0) ||
    (typeof session.closeReason === "string" && session.closeReason.length > 0)
  );
}
