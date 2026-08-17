import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import {
  KITESURF_ENGINE,
  type BrowserSnapshot,
  type SnapshotFormat,
} from "./browser-gateway";

export type BrowserSnapshotWaitUntil =
  | "domcontentloaded"
  | "load"
  | "networkidle0"
  | "networkidle2";

export interface SavedWorkflowSummary {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

export interface WorkflowRunProjection {
  readonly runId: string;
  readonly workflowId: string;
  readonly status: string;
  readonly lane: "unknown" | "fenced";
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly error: { readonly message: string; readonly errorType: string | null } | null;
  readonly hasDeclaredInput: boolean;
  readonly hasFinalOutput: boolean;
  readonly hasFinalState: boolean;
}

export interface WorkflowRunArtifactDescriptor {
  readonly artifactRef: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface WorkflowRunArtifactReader {
  readonly descriptor: WorkflowRunArtifactDescriptor;
  readonly body: ReadableStream<Uint8Array>;
  close(): Promise<void>;
}

export interface WorkflowRunsV1 {
  get(options: { readonly runId: string }): Promise<WorkflowRunProjection>;
  wait(options: {
    readonly runId: string;
    readonly timeoutMs?: number;
  }): Promise<WorkflowRunProjection>;
  cancel(options: { readonly runId: string }): Promise<WorkflowRunProjection>;
  output(options: {
    readonly runId: string;
    readonly kind?: "final-output" | "final-state" | "declared-input";
  }): Promise<unknown>;
  openArtifact?(options: {
    readonly runId: string;
    readonly artifactRef: string;
  }): Promise<WorkflowRunArtifactReader>;
}

export interface SavedWorkflowsApi {
  list(options?: {
    readonly workspaceId?: string;
  }): Promise<{ readonly workflows: readonly SavedWorkflowSummary[] }> | {
    readonly workflows: readonly SavedWorkflowSummary[];
  };
  invokeSaved(options: {
    readonly workflowId: string;
    readonly payload?: unknown;
  }): Promise<{
    readonly success: boolean;
    readonly status: string;
    readonly message: string;
    readonly runId?: string | null;
    readonly error?: string | null;
  }> | {
    readonly success: boolean;
    readonly status: string;
    readonly message: string;
    readonly runId?: string | null;
    readonly error?: string | null;
  };
  readonly runs?: { readonly v1?: WorkflowRunsV1 };
}

export interface WorkflowSnapshotArtifact {
  readonly kind: SnapshotFormat;
  readonly artifactRef: string;
  readonly mediaType: string;
  readonly byteLength: number | null;
  readonly sha256: string | null;
}

export interface WorkflowBrowserSnapshot extends BrowserSnapshot {
  readonly workflowRunId: string;
  readonly screenshotArtifact: WorkflowSnapshotArtifact | null;
  readonly outputProjected?: boolean;
  readonly outputProjectionOriginalByteLength?: number | null;
  readonly unavailableFormats?: readonly SnapshotFormat[];
}

export interface SavedBrowserSnapshotInput {
  readonly workflowId: string;
  readonly url: string;
  readonly formats: readonly SnapshotFormat[];
  readonly waitUntil: BrowserSnapshotWaitUntil;
  readonly timeoutMs: number;
  readonly waitTimeoutMs?: number;
  readonly onRunStarted?: (runId: string) => void;
}

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const MAX_WAIT_SLICE_MS = 30_000;
const MAX_OUTPUT_SEARCH_DEPTH = 24;
const MAX_OUTPUT_SEARCH_NODES = 10_000;
const TERMINAL_SUCCESS = new Set(["completed", "succeeded", "success"]);
const TERMINAL_FAILURE = new Set([
  "cancelled",
  "canceled",
  "failed",
  "skipped",
  "timed_out",
  "timeout",
]);
const SNAPSHOT_FORMATS = new Set<SnapshotFormat>([
  "screenshot",
  "markdown",
  "accessibilityTree",
  "content",
]);
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const BASE64_INPUT_CHUNK_BYTES = 3 * 8_192;
const WORKFLOW_OUTPUT_PROJECTION_TYPE = "workflow_output_projection";
const WORKFLOW_OUTPUT_OMISSION_TYPE = "workflow_output_value_omitted";
const WORKFLOW_OUTPUT_PROJECTION_RETENTION =
  "validated_artifact_descriptors_and_scalar_metadata";

interface WorkflowOutputProjection {
  readonly originalByteLength: number;
  readonly artifacts: readonly unknown[];
  readonly value: unknown;
}

function pngBytesDataUrl(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_INPUT_CHUNK_BYTES) {
    const end = Math.min(offset + BASE64_INPUT_CHUNK_BYTES, bytes.byteLength);
    let binary = "";
    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    chunks.push(globalThis.btoa(binary));
  }
  return `data:image/png;base64,${chunks.join("")}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
    throw new Error("The workflow browser output returned an invalid page title.");
  }
  return value;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function workflowOutputProjection(value: unknown): WorkflowOutputProjection | null {
  const candidate = record(value);
  if (candidate?.type !== WORKFLOW_OUTPUT_PROJECTION_TYPE) return null;
  const originalByteLength = finiteNumber(candidate.originalByteLength);
  if (
    candidate.truncated !== true ||
    candidate.retained !== WORKFLOW_OUTPUT_PROJECTION_RETENTION ||
    originalByteLength === null ||
    !Number.isSafeInteger(originalByteLength) ||
    originalByteLength <= 0 ||
    !Array.isArray(candidate.artifacts) ||
    !("value" in candidate)
  ) {
    throw new Error("The workflow returned an invalid bounded output projection.");
  }
  return {
    originalByteLength,
    artifacts: candidate.artifacts,
    value: candidate.value,
  };
}

function projectedOmission(value: unknown, valueType: string): boolean {
  const candidate = record(value);
  const originalByteLength = finiteNumber(candidate?.originalByteLength);
  return (
    candidate?.type === WORKFLOW_OUTPUT_OMISSION_TYPE &&
    candidate.truncated === true &&
    candidate.valueType === valueType &&
    originalByteLength !== null &&
    Number.isSafeInteger(originalByteLength) &&
    originalByteLength >= 0
  );
}

function pageStatus(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 100 ||
    value > 599
  ) {
    throw new Error("The workflow browser output returned an invalid page status.");
  }
  return value;
}

function optionalDuration(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`The workflow browser output returned invalid ${label}.`);
  }
  return value;
}

function evidenceUrl(value: unknown, label: string): string {
  const raw = stringValue(value);
  if (!raw) throw new Error(`The workflow browser output omitted ${label}.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`The workflow browser output returned an invalid ${label}.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error(`The workflow browser output returned an invalid ${label}.`);
  }
  return url.toString();
}

function pngDataUrl(value: unknown): string | null {
  const encoded = stringValue(value);
  if (!encoded) return null;
  const payload = encoded.startsWith("data:image/png;base64,")
    ? encoded.slice("data:image/png;base64,".length)
    : encoded;
  if (payload.length > Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4) {
    throw new Error(
      "The workflow browser output exceeded the 10 MiB inline screenshot limit.",
    );
  }
  if (!payload || !/^(?:[0-9A-Za-z+/]{4})*(?:[0-9A-Za-z+/]{2}==|[0-9A-Za-z+/]{3}=)?$/u.test(payload)) {
    throw new Error("The workflow browser output returned an invalid PNG screenshot.");
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const decodedSize = payload.length / 4 * 3 - padding;
  if (decodedSize <= 0 || decodedSize > MAX_SCREENSHOT_BYTES) {
    throw new Error(
      "The workflow browser output exceeded the 10 MiB inline screenshot limit.",
    );
  }
  const signature = globalThis.atob(payload.slice(0, 12));
  if (
    PNG_SIGNATURE.some(
      (byte, index) => signature.charCodeAt(index) !== byte,
    )
  ) {
    throw new Error("The workflow browser output returned an invalid PNG screenshot.");
  }
  return `data:image/png;base64,${payload}`;
}

function normalizedStatus(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_");
}

function looksLikeSnapshot(value: Record<string, unknown>): boolean {
  const url = stringValue(value.url);
  const engine = stringValue(value.engine);
  const formats = value.formats;
  return (
    url !== null &&
    (url.startsWith("https://") || url.startsWith("http://")) &&
    engine !== null &&
    engine.length > 0 &&
    engine.length <= 64 &&
    Array.isArray(formats)
  );
}

function findSnapshotOutput(output: unknown): Record<string, unknown> {
  let remainingNodes = MAX_OUTPUT_SEARCH_NODES;
  const visit = (
    value: unknown,
    depth: number,
  ): Record<string, unknown> | null => {
    remainingNodes -= 1;
    if (remainingNodes < 0 || depth > MAX_OUTPUT_SEARCH_DEPTH) {
      throw new Error("The workflow output exceeds the browser evidence limit.");
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const candidate = record(value);
    if (!candidate) return null;
    if (looksLikeSnapshot(candidate)) return candidate;
    for (const item of Object.values(candidate)) {
      const found = visit(item, depth + 1);
      if (found) return found;
    }
    return null;
  };

  const found = visit(output, 0);
  if (found) return found;

  throw new Error(
    "The workflow final output does not expose universal.browser.snapshot evidence.",
  );
}

function normalizeArtifact(value: unknown): WorkflowSnapshotArtifact {
  const candidate = record(value);
  if (!candidate) {
    throw new Error("The workflow returned an invalid browser evidence artifact.");
  }
  const kind = stringValue(candidate.kind);
  const artifactRef = stringValue(candidate.artifactRef);
  const mediaType = stringValue(candidate.mediaType);
  const byteLength = finiteNumber(candidate.byteLength ?? candidate.sizeBytes);
  const sha256 = stringValue(candidate.sha256);
  if (
    kind !== "screenshot" ||
    !artifactRef ||
    !/^sha256:[0-9a-f]{64}$/u.test(artifactRef) ||
    mediaType !== "image/png" ||
    !sha256 ||
    !/^[0-9a-f]{64}$/u.test(sha256) ||
    artifactRef !== `sha256:${sha256}` ||
    byteLength === null ||
    !Number.isSafeInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > MAX_SCREENSHOT_BYTES
  ) {
    throw new Error("The workflow returned an invalid browser evidence artifact.");
  }
  return {
    kind,
    artifactRef,
    mediaType,
    byteLength,
    sha256,
  };
}

export function normalizeWorkflowBrowserSnapshot(
  output: unknown,
  input: {
    readonly runId: string;
    readonly requestedUrl: string;
    readonly requestedFormats: readonly SnapshotFormat[];
  },
): WorkflowBrowserSnapshot {
  const projection = workflowOutputProjection(output);
  const result = findSnapshotOutput(projection?.value ?? output);
  const returnedEngine = stringValue(result.engine);
  if (returnedEngine !== KITESURF_ENGINE) {
    throw new Error(
      `The workflow returned ${returnedEngine ?? "no engine"}; ${KITESURF_ENGINE} was required.`,
    );
  }
  if (
    !Array.isArray(result.formats) ||
    result.formats.some(
      (format) =>
        typeof format !== "string" ||
        !SNAPSHOT_FORMATS.has(format as SnapshotFormat),
    )
  ) {
    throw new Error("The workflow returned invalid evidence formats.");
  }
  const returnedFormats = result.formats as SnapshotFormat[];
  if (
    returnedFormats.length !== input.requestedFormats.length ||
    new Set(returnedFormats).size !== returnedFormats.length ||
    input.requestedFormats.some((format) => !returnedFormats.includes(format))
  ) {
    throw new Error("The workflow returned evidence formats that do not match the request.");
  }
  const requestedUrl = evidenceUrl(input.requestedUrl, "requested URL");
  const returnedUrl = evidenceUrl(result.url, "source URL");
  if (returnedUrl !== requestedUrl) {
    throw new Error("The workflow browser output does not match the requested URL.");
  }
  const finalUrl = result.finalUrl === undefined ||
    (projection !== null && projectedOmission(result.finalUrl, "string"))
    ? null
    : evidenceUrl(result.finalUrl, "final URL");
  const artifactValues = projection?.artifacts ?? result.artifacts ?? [];
  if (!Array.isArray(artifactValues)) {
    throw new Error("The workflow returned invalid browser evidence artifacts.");
  }
  const artifacts = artifactValues.map(normalizeArtifact);
  const screenshotArtifacts = artifacts.filter(
    (artifact) => artifact.kind === "screenshot",
  );
  if (projection && screenshotArtifacts.length > 1) {
    throw new Error("The bounded workflow output contains ambiguous screenshot artifacts.");
  }
  const screenshotArtifact = screenshotArtifacts[0] ?? null;
  const inlineScreenshot = pngDataUrl(result.screenshot);
  const markdown = evidenceString(result.markdown);
  const content = evidenceString(result.content);
  const accessibilityTree =
    result.accessibilityTree !== undefined &&
    result.accessibilityTree !== null &&
    typeof result.accessibilityTree === "object" &&
    !Array.isArray(result.accessibilityTree) &&
    !projectedOmission(result.accessibilityTree, "object")
      ? result.accessibilityTree
      : null;
  const unavailableFormats: SnapshotFormat[] = [];
  for (const format of input.requestedFormats) {
    const present =
      format === "screenshot"
        ? inlineScreenshot !== null || screenshotArtifact !== null
        : format === "markdown"
          ? markdown !== null
          : format === "content"
            ? content !== null
        : accessibilityTree !== null &&
          typeof accessibilityTree === "object" &&
          !Array.isArray(accessibilityTree);
    if (!present && projection && format !== "screenshot") {
      const omitted =
        format === "markdown"
          ? result.markdown === undefined ||
            projectedOmission(result.markdown, "string")
          : format === "content"
            ? result.content === undefined ||
              projectedOmission(result.content, "string")
            : result.accessibilityTree === undefined ||
              projectedOmission(result.accessibilityTree, "object");
      if (!omitted) {
        throw new Error(
          `The bounded workflow output contains invalid projected ${format} evidence.`,
        );
      }
      unavailableFormats.push(format);
      continue;
    }
    if (!present) {
      throw new Error(`The workflow omitted requested ${format} evidence.`);
    }
  }

  return {
    workflowRunId: input.runId,
    engine: returnedEngine,
    requestedUrl,
    finalUrl,
    formats: returnedFormats,
    title:
      projection && projectedOmission(result.title, "string")
        ? null
        : optionalTitle(result.title),
    status: pageStatus(result.status),
    browserMs: optionalDuration(result.browserMs, "browser time"),
    runDurationMs: optionalDuration(result.durationMs, "workflow run time"),
    screenshotDataUrl: inlineScreenshot,
    screenshotArtifact,
    markdown,
    content,
    accessibilityTree,
    receivedAt: new Date().toISOString(),
    outputProjected: projection !== null,
    outputProjectionOriginalByteLength:
      projection?.originalByteLength ?? null,
    unavailableFormats,
  };
}

export function getSavedWorkflowsApi(): SavedWorkflowsApi {
  return sdk.workflows as unknown as SavedWorkflowsApi;
}

export function hasWorkflowRunsV1(
  workflows?: SavedWorkflowsApi,
): boolean {
  try {
    const runs = (workflows ?? getSavedWorkflowsApi()).runs?.v1;
    return Boolean(
      runs &&
        typeof runs.wait === "function" &&
        typeof runs.output === "function" &&
        typeof runs.cancel === "function",
    );
  } catch {
    return false;
  }
}

export function requireWorkflowRunsV1(
  workflows: SavedWorkflowsApi = getSavedWorkflowsApi(),
): WorkflowRunsV1 {
  const runs = workflows.runs?.v1;
  if (!runs || !hasWorkflowRunsV1(workflows)) {
    throw new Error(
      "This TAP host predates the workflows.runs.v1 capability required for durable browser evidence.",
    );
  }
  return runs;
}

export async function listSavedWorkflows(
  workspaceId: string | undefined,
  workflows: SavedWorkflowsApi = getSavedWorkflowsApi(),
): Promise<readonly SavedWorkflowSummary[]> {
  const result = await workflows.list(
    workspaceId ? { workspaceId } : undefined,
  );
  return result.workflows;
}

export async function runSavedBrowserSnapshot(
  input: SavedBrowserSnapshotInput,
  workflows: SavedWorkflowsApi = getSavedWorkflowsApi(),
): Promise<WorkflowBrowserSnapshot> {
  const runs = requireWorkflowRunsV1(workflows);
  const invocation = await workflows.invokeSaved({
    workflowId: input.workflowId,
    payload: {
      url: input.url,
      engine: KITESURF_ENGINE,
      formats: [...input.formats],
      waitUntil: input.waitUntil,
      timeoutMs: input.timeoutMs,
    },
  });
  if (!invocation.success) {
    throw new Error(
      invocation.error || invocation.message || "The saved workflow could not start.",
    );
  }
  const runId = invocation.runId;
  if (!runId) {
    throw new Error("The saved workflow did not return a durable run ID.");
  }
  input.onRunStarted?.(runId);

  const overallWaitMs = input.waitTimeoutMs ?? 120_000;
  if (!Number.isSafeInteger(overallWaitMs) || overallWaitMs < 0) {
    throw new Error("The workflow run wait deadline is invalid.");
  }
  const deadline = Date.now() + overallWaitMs;
  let run: WorkflowRunProjection;
  while (true) {
    const remainingMs = Math.max(0, deadline - Date.now());
    const waitStartedAt = Date.now();
    run = await runs.wait({
      runId,
      timeoutMs: Math.min(MAX_WAIT_SLICE_MS, remainingMs),
    });
    const status = normalizedStatus(run.status);
    if (
      TERMINAL_SUCCESS.has(status) ||
      TERMINAL_FAILURE.has(status)
    ) {
      break;
    }
    if (remainingMs === 0 || Date.now() >= deadline) {
      throw new Error(
        `The browser workflow is still ${run.status}; reopen run ${runId} to continue tracking it.`,
      );
    }
    if (Date.now() - waitStartedAt < 250) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 250));
    }
  }
  const status = normalizedStatus(run.status);
  if (TERMINAL_FAILURE.has(status)) {
    throw new Error(
      run.error?.message ?? `The browser workflow ended with status ${run.status}.`,
    );
  }
  const output = await runs.output({ runId, kind: "final-output" });
  return normalizeWorkflowBrowserSnapshot(output, {
    runId,
    requestedUrl: input.url,
    requestedFormats: input.formats,
  });
}

export async function cancelSavedBrowserSnapshotRun(
  runId: string,
  workflows: SavedWorkflowsApi = getSavedWorkflowsApi(),
): Promise<WorkflowRunProjection> {
  return requireWorkflowRunsV1(workflows).cancel({ runId });
}

export function canOpenWorkflowRunArtifact(
  workflows: SavedWorkflowsApi = getSavedWorkflowsApi(),
): boolean {
  return typeof workflows.runs?.v1?.openArtifact === "function";
}

export async function readWorkflowRunArtifact(
  runId: string,
  artifact: WorkflowSnapshotArtifact,
  workflows: SavedWorkflowsApi = getSavedWorkflowsApi(),
): Promise<string | null> {
  const runs = requireWorkflowRunsV1(workflows);
  if (!runs.openArtifact) return null;
  const reader = await runs.openArtifact({
    runId,
    artifactRef: artifact.artifactRef,
  });
  try {
    const descriptor = reader.descriptor;
    if (
      descriptor.artifactRef !== artifact.artifactRef ||
      descriptor.mediaType !== "image/png" ||
      !/^sha256:[0-9a-f]{64}$/u.test(descriptor.artifactRef) ||
      !/^[0-9a-f]{64}$/u.test(descriptor.sha256) ||
      descriptor.artifactRef !== `sha256:${descriptor.sha256}` ||
      !Number.isSafeInteger(descriptor.sizeBytes) ||
      descriptor.sizeBytes <= 0 ||
      descriptor.sizeBytes > MAX_SCREENSHOT_BYTES ||
      descriptor.sizeBytes !== artifact.byteLength ||
      descriptor.sha256 !== artifact.sha256
    ) {
      throw new Error("The workflow screenshot artifact descriptor is invalid.");
    }
    const streamReader = reader.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await streamReader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_SCREENSHOT_BYTES) {
          await streamReader.cancel("display limit exceeded");
          throw new Error(
            "The workflow screenshot artifact exceeded the 10 MiB display limit.",
          );
        }
        chunks.push(next.value);
      }
    } finally {
      streamReader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (size !== descriptor.sizeBytes) {
      throw new Error("The workflow screenshot artifact size does not match its descriptor.");
    }
    if (
      PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
    ) {
      throw new Error("The workflow screenshot artifact is not a PNG image.");
    }
    const digest = new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-256", bytes),
    );
    const actualSha256 = [...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (actualSha256 !== descriptor.sha256) {
      throw new Error("The workflow screenshot artifact failed SHA-256 verification.");
    }
    return pngBytesDataUrl(bytes);
  } finally {
    await reader.close().catch(() => undefined);
  }
}
