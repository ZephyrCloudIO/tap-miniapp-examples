export const KITESURF_ENGINE = "kitesurf" as const;
export type BrowserEngine = typeof KITESURF_ENGINE;
export type BrowserControlHolder = "agent" | "human";
export type SnapshotFormat =
  | "screenshot"
  | "markdown"
  | "accessibilityTree"
  | "content";
export type SnapshotWaitUntil =
  | "domcontentloaded"
  | "load"
  | "networkidle0"
  | "networkidle2";

export interface SnapshotInput {
  readonly url: string;
  readonly engine: BrowserEngine;
  readonly formats: readonly SnapshotFormat[];
  readonly waitUntil: SnapshotWaitUntil;
  readonly timeoutMs: number;
}

export interface SessionInput {
  readonly url: string;
  readonly engine: BrowserEngine;
  readonly keepAliveMs: number;
  readonly viewport: BrowserViewport;
}

export interface BrowserViewport {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly mobile: boolean;
}

export const DEFAULT_BROWSER_VIEWPORT: BrowserViewport = {
  width: 1_440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
};

export interface SessionRenewInput {
  readonly leaseMs: number;
}

export interface SessionHandoffInput {
  readonly expectedEpoch: number;
  readonly to: BrowserControlHolder;
  readonly leaseMs: number | null;
}

export interface SessionControlAssertionInput {
  readonly holder: BrowserControlHolder;
  readonly epoch: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function engine(value: unknown): BrowserEngine {
  if (value === KITESURF_ENGINE) return KITESURF_ENGINE;
  throw new ApiError(
    400,
    "invalid_engine",
    `engine must be ${KITESURF_ENGINE}.`,
  );
}

function snapshotWaitUntil(value: unknown): SnapshotWaitUntil {
  if (value === undefined) return "domcontentloaded";
  if (
    value === "domcontentloaded" ||
    value === "load" ||
    value === "networkidle0" ||
    value === "networkidle2"
  ) {
    return value;
  }
  throw new ApiError(
    400,
    "invalid_wait_until",
    "waitUntil must be domcontentloaded, load, networkidle0, or networkidle2.",
  );
}

function snapshotTimeout(value: unknown): number {
  if (value === undefined) return 30_000;
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new ApiError(
      400,
      "invalid_timeout",
      "timeoutMs must be an integer from 1000 to 60000.",
    );
  }
  return timeoutMs;
}

function isPrivateIpv4(hostname: string): boolean {
  const pieces = hostname.split(".");
  if (pieces.length !== 4 || pieces.some((piece) => !/^\d{1,3}$/u.test(piece))) {
    return false;
  }
  const octets = pieces.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function allowedHost(hostname: string, rules: readonly string[]): boolean {
  return rules.some((rule) => {
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1);
      return hostname.endsWith(suffix) && hostname !== suffix.slice(1);
    }
    return hostname === rule;
  });
}

function validDomainRule(rule: string): boolean {
  const hostname = rule.startsWith("*.") ? rule.slice(2) : rule;
  return (
    hostname.length > 0 &&
    hostname.length <= 253 &&
    !hostname.includes("..") &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(hostname) &&
    !hostname.includes(":") &&
    !isPrivateIpv4(hostname) &&
    hostname !== "localhost" &&
    !hostname.endsWith(".localhost") &&
    !hostname.endsWith(".local") &&
    !hostname.endsWith(".internal")
  );
}

export function configuredAllowedDomains(configured: string): readonly string[] {
  const rules = configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    rules.length === 0 ||
    rules.length > 50 ||
    new Set(rules).size !== rules.length ||
    rules.some((rule) => !validDomainRule(rule))
  ) {
    throw new ApiError(
      503,
      "invalid_allowed_hosts",
      "ALLOWED_HOSTS must contain one to fifty unique public hostnames or *.domain patterns.",
    );
  }
  return rules;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Quick Actions do not expose session guardrails, so use their documented
 * request-pattern allowlist to cover the initial navigation, redirects, and
 * subresources. Session traffic uses `guardrails.allowedDomains` instead.
 */
export function allowedRequestPatterns(configured: string): readonly string[] {
  return configuredAllowedDomains(configured).map((rule) => {
    if (rule.startsWith("*.")) {
      return `^https?:\\/\\/(?:[^./?#]+\\.)+${escapeRegex(rule.slice(2))}(?::\\d+)?(?:[/?#]|$)`;
    }
    return `^https?:\\/\\/${escapeRegex(rule)}(?::\\d+)?(?:[/?#]|$)`;
  });
}

export function validateTargetUrl(value: unknown, allowedHosts: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "missing_url", "A target URL is required.");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ApiError(400, "invalid_url", "Target URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "invalid_url_scheme", "Only HTTP and HTTPS are allowed.");
  }
  if (url.username || url.password) {
    throw new ApiError(400, "url_credentials_denied", "Target URLs cannot contain credentials.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.includes(":") ||
    isPrivateIpv4(hostname)
  ) {
    throw new ApiError(403, "private_target_denied", "Private and local targets are denied.");
  }
  if (!allowedHost(hostname, configuredAllowedDomains(allowedHosts))) {
    throw new ApiError(403, "target_not_allowed", "Target hostname is outside the gateway allowlist.");
  }
  url.hash = "";
  return url.toString();
}

function leaseDuration(value: unknown, label: string): number {
  const leaseMs = value === undefined ? 300_000 : Number(value);
  if (!Number.isInteger(leaseMs) || leaseMs < 60_000 || leaseMs > 600_000) {
    throw new ApiError(
      400,
      `invalid_${label}`,
      `${label} must be an integer from 60000 to 600000.`,
    );
  }
  return leaseMs;
}

function browserViewport(value: unknown): BrowserViewport {
  if (value === undefined) return DEFAULT_BROWSER_VIEWPORT;
  const viewport = record(value);
  const width = Number(viewport.width);
  const height = Number(viewport.height);
  const deviceScaleFactor = Number(viewport.deviceScaleFactor);
  if (!Number.isInteger(width) || width < 320 || width > 1_920) {
    throw new ApiError(
      400,
      "invalid_viewport_width",
      "viewport.width must be an integer from 320 to 1920.",
    );
  }
  if (!Number.isInteger(height) || height < 240 || height > 1_200) {
    throw new ApiError(
      400,
      "invalid_viewport_height",
      "viewport.height must be an integer from 240 to 1200.",
    );
  }
  if (
    !Number.isFinite(deviceScaleFactor) ||
    deviceScaleFactor < 1 ||
    deviceScaleFactor > 3
  ) {
    throw new ApiError(
      400,
      "invalid_device_scale_factor",
      "viewport.deviceScaleFactor must be from 1 to 3.",
    );
  }
  if (typeof viewport.mobile !== "boolean") {
    throw new ApiError(
      400,
      "invalid_mobile_emulation",
      "viewport.mobile must be a boolean.",
    );
  }
  return { width, height, deviceScaleFactor, mobile: viewport.mobile };
}

export function parseSnapshotInput(
  value: unknown,
  allowedHosts: string,
): SnapshotInput {
  const body = record(value);
  const rawFormats = body.formats;
  if (!Array.isArray(rawFormats)) {
    throw new ApiError(400, "invalid_formats", "formats must be an array.");
  }
  const accepted = new Set<SnapshotFormat>([
    "screenshot",
    "markdown",
    "accessibilityTree",
    "content",
  ]);
  const formats: SnapshotFormat[] = [];
  for (const item of rawFormats) {
    if (typeof item !== "string" || !accepted.has(item as SnapshotFormat)) {
      throw new ApiError(400, "invalid_formats", "An unsupported snapshot format was requested.");
    }
    const format = item as SnapshotFormat;
    if (!formats.includes(format)) formats.push(format);
  }
  if (formats.length < 2 || formats.length > 4) {
    throw new ApiError(
      400,
      "invalid_formats",
      "Snapshot requests require two to four unique formats.",
    );
  }
  return {
    url: validateTargetUrl(body.url, allowedHosts),
    engine: engine(body.engine),
    formats,
    waitUntil: snapshotWaitUntil(body.waitUntil),
    timeoutMs: snapshotTimeout(body.timeoutMs),
  };
}

export function parseSessionInput(
  value: unknown,
  allowedHosts: string,
): SessionInput {
  const body = record(value);
  return {
    url: validateTargetUrl(body.url, allowedHosts),
    engine: engine(body.engine),
    keepAliveMs: leaseDuration(body.keepAliveMs, "keep_alive"),
    viewport: browserViewport(body.viewport),
  };
}

export function parseSessionRenewInput(value: unknown): SessionRenewInput {
  const body = record(value);
  return { leaseMs: leaseDuration(body.leaseMs, "lease") };
}

export function parseSessionHandoffInput(value: unknown): SessionHandoffInput {
  const body = record(value);
  const expectedEpoch = Number(body.expectedEpoch);
  if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 1) {
    throw new ApiError(
      400,
      "invalid_control_epoch",
      "expectedEpoch must be a positive integer.",
    );
  }
  if (body.to !== "agent" && body.to !== "human") {
    throw new ApiError(
      400,
      "invalid_control_holder",
      "to must be either agent or human.",
    );
  }
  return {
    expectedEpoch,
    to: body.to,
    leaseMs:
      body.to === "human"
        ? leaseDuration(body.leaseMs, "control_lease")
        : null,
  };
}

export function parseSessionControlAssertionInput(
  value: unknown,
): SessionControlAssertionInput {
  const body = record(value);
  if (body.holder !== "agent" && body.holder !== "human") {
    throw new ApiError(
      400,
      "invalid_control_holder",
      "holder must be either agent or human.",
    );
  }
  const epoch = Number(body.epoch);
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    throw new ApiError(
      400,
      "invalid_control_epoch",
      "epoch must be a positive integer.",
    );
  }
  return { holder: body.holder, epoch };
}

export function parseCloseWaitMs(value: string | null): number {
  if (value === null || value === "" || value === "false") return 0;
  if (value === "true") return 5_000;
  const waitMs = Number(value);
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 10_000) {
    throw new ApiError(
      400,
      "invalid_close_wait",
      "waitMs must be an integer from 0 to 10000.",
    );
  }
  return waitMs;
}

export function validateSessionId(value: string): string {
  if (!/^[0-9A-Za-z-]{1,128}$/u.test(value)) {
    throw new ApiError(400, "invalid_session_id", "Session ID is invalid.");
  }
  return value;
}
