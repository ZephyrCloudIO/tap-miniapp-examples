export const KITESURF_ENGINE = "kitesurf" as const;
export type BrowserEngine = typeof KITESURF_ENGINE;
export type SnapshotFormat =
  | "screenshot"
  | "markdown"
  | "accessibilityTree"
  | "content";

export interface GatewayContext {
  readonly preview: boolean;
  readonly previewBearer: string;
}

export interface SnapshotRequest {
  readonly gatewayOrigin: string;
  readonly url: string;
  readonly formats: readonly SnapshotFormat[];
}

export interface BrowserSnapshot {
  readonly engine: BrowserEngine;
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly formats: readonly SnapshotFormat[];
  readonly title: string | null;
  readonly status: number | null;
  readonly browserMs: number | null;
  readonly runDurationMs: number | null;
  readonly screenshotDataUrl: string | null;
  readonly markdown: string | null;
  readonly content: string | null;
  readonly accessibilityTree: unknown | null;
  readonly receivedAt: string;
}

interface GatewayResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly { readonly name: string; readonly value: string }[];
  readonly bodyText: string;
}

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The browser gateway returned an invalid JSON object.");
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function evidenceString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalTitle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 1_024) {
    throw new Error("The browser gateway returned an invalid page title.");
  }
  return value;
}

function returnedFormats(value: unknown): readonly SnapshotFormat[] {
  const allowed = new Set<SnapshotFormat>([
    "screenshot",
    "markdown",
    "accessibilityTree",
    "content",
  ]);
  if (
    !Array.isArray(value) ||
    value.some(
      (format) => typeof format !== "string" || !allowed.has(format as SnapshotFormat),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("The browser gateway returned invalid evidence formats.");
  }
  return value as SnapshotFormat[];
}

function pageStatus(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 100 ||
    value > 599
  ) {
    throw new Error("The browser gateway returned an invalid page status.");
  }
  return value;
}

function browserTime(value: string | null): number | null {
  if (value === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error("The browser gateway returned invalid browser time.");
  }
  const duration = Number(value);
  if (!Number.isSafeInteger(duration)) {
    throw new Error("The browser gateway returned invalid browser time.");
  }
  return duration;
}

function optionalPageUrl(value: unknown): string | null {
  const raw = stringValue(value);
  if (raw === null) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The browser gateway returned an invalid final URL.");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password
  ) {
    throw new Error("The browser gateway returned an invalid final URL.");
  }
  return url.toString();
}

function pngDataUrl(value: unknown): string | null {
  const encoded = stringValue(value);
  if (!encoded) return null;
  const payload = encoded.startsWith("data:image/png;base64,")
    ? encoded.slice("data:image/png;base64,".length)
    : encoded;
  if (!payload || !/^(?:[0-9A-Za-z+/]{4})*(?:[0-9A-Za-z+/]{2}==|[0-9A-Za-z+/]{3}=)?$/u.test(payload)) {
    throw new Error("The browser gateway returned an invalid PNG screenshot.");
  }
  const signature = globalThis.atob(payload.slice(0, 12));
  if (
    PNG_SIGNATURE.some(
      (byte, index) => signature.charCodeAt(index) !== byte,
    )
  ) {
    throw new Error("The browser gateway returned an invalid PNG screenshot.");
  }
  return `data:image/png;base64,${payload}`;
}

function headerValue(
  headers: readonly { readonly name: string; readonly value: string }[],
  name: string,
): string | null {
  const normalized = name.toLowerCase();
  return (
    headers.find((header) => header.name.toLowerCase() === normalized)?.value ??
    null
  );
}

function responseError(response: GatewayResponse): Error {
  let message = `${response.status} ${response.statusText}`.trim();
  try {
    const payload = asRecord(JSON.parse(response.bodyText));
    const error = payload.error;
    if (typeof error === "string") message = error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      message = stringValue(Reflect.get(error, "message")) ?? message;
    }
    if (Array.isArray(payload.errors)) {
      const first = payload.errors[0];
      if (first && typeof first === "object") {
        message = stringValue(Reflect.get(first, "message")) ?? message;
      }
    }
  } catch {
    // Preserve the bounded HTTP status when the upstream body is not JSON.
  }
  return new Error(`Browser gateway request failed: ${message}`);
}

function normalizeGatewayOrigin(value: string, preview: boolean): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid browser gateway URL.");
  }
  const localPreview =
    preview &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localPreview) {
    throw new Error("The browser gateway must use HTTPS outside local preview.");
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new Error("Gateway URLs cannot contain credentials, query, or fragments.");
  }
  return url.toString().replace(/\/$/u, "");
}

async function request(
  origin: string,
  path: string,
  method: "POST",
  body: Readonly<Record<string, unknown>> | null,
  context: GatewayContext,
): Promise<GatewayResponse> {
  if (!context.preview) {
    throw new Error(
      "Packaged browser snapshots must run through a saved workflow.",
    );
  }
  const url = `${normalizeGatewayOrigin(origin, context.preview)}${path}`;
  const serialized = body ? JSON.stringify(body) : null;
  const headers = new Headers();
  if (serialized) headers.set("Content-Type", "application/json");
  if (context.previewBearer.trim()) {
    headers.set("Authorization", `Bearer ${context.previewBearer.trim()}`);
  }
  const response = await fetch(url, {
    method,
    headers,
    body: serialized,
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("The browser gateway response exceeded the preview limit.");
  }
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers].map(([name, value]) => ({ name, value })),
    bodyText: text,
  };
}

export async function captureSnapshot(
  input: SnapshotRequest,
  context: GatewayContext,
): Promise<BrowserSnapshot> {
  const response = await request(
    input.gatewayOrigin,
    "/v1/snapshot",
    "POST",
    {
      url: input.url,
      engine: KITESURF_ENGINE,
      formats: [...input.formats],
      waitUntil: "domcontentloaded",
      timeoutMs: 30_000,
    },
    context,
  );
  if (response.status < 200 || response.status >= 300) {
    throw responseError(response);
  }

  const payload = asRecord(JSON.parse(response.bodyText));
  if (payload.success !== true) throw responseError(response);
  const result = asRecord(payload.result);
  const meta = payload.meta ? asRecord(payload.meta) : {};
  const formats = returnedFormats(meta.formats);
  if (
    formats.length !== input.formats.length ||
    input.formats.some((format) => !formats.includes(format))
  ) {
    throw new Error("The browser gateway returned evidence formats that do not match the request.");
  }
  const screenshot = pngDataUrl(result.screenshot);
  const markdown = evidenceString(result.markdown);
  const content = evidenceString(result.content);
  const accessibilityTree = result.accessibilityTree ?? null;
  for (const format of formats) {
    const present =
      format === "screenshot"
        ? screenshot !== null
        : format === "markdown"
          ? markdown !== null
          : format === "content"
            ? content !== null
            : accessibilityTree !== null;
    if (!present) {
      throw new Error(`The browser gateway omitted requested ${format} evidence.`);
    }
  }
  const browserMsValue = browserTime(
    headerValue(response.headers, "x-browser-ms-used"),
  );
  const engine = headerValue(response.headers, "x-agent-browser-engine");
  if (engine !== KITESURF_ENGINE) {
    throw new Error(
      `The browser gateway returned ${engine ?? "no engine"}; ${KITESURF_ENGINE} was required.`,
    );
  }

  return {
    engine,
    requestedUrl: input.url,
    finalUrl: optionalPageUrl(result.finalUrl ?? meta.finalUrl),
    formats,
    title: optionalTitle(meta.title),
    status: pageStatus(meta.status),
    browserMs: browserMsValue,
    runDurationMs: null,
    screenshotDataUrl: screenshot,
    markdown,
    content,
    accessibilityTree,
    receivedAt: new Date().toISOString(),
  };
}
