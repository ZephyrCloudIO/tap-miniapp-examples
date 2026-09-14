const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TOKEN_MAX_LENGTH = 2_048;
const SECRET_MAX_LENGTH = 4_096;
const BOOKING_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const VERIFICATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IP_PATTERN = /^[0-9a-f:.]{2,64}$/iu;
const MAX_CHALLENGE_AGE_MS = 5 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 60 * 1_000;
const VERIFICATION_ID_DOMAIN = "tap.calendar.public-turnstile.v1";

export class PublicTurnstileError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "PublicTurnstileError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const unconfigured = (): never => {
  throw new PublicTurnstileError(
    503,
    "public_booking_unconfigured",
    "Public booking protection is not configured.",
    true,
  );
};

const unavailable = (): never => {
  throw new PublicTurnstileError(
    503,
    "turnstile_unavailable",
    "Security verification could not be checked. Try again shortly.",
    true,
  );
};

const rejected = (): never => {
  throw new PublicTurnstileError(
    403,
    "turnstile_failed",
    "Security verification expired or was rejected. Complete it again.",
    false,
  );
};

export const publicClientIp = (request: Request): string | null => {
  const candidate = request.headers.get("CF-Connecting-IP")?.trim() ?? "";
  return candidate && IP_PATTERN.test(candidate) ? candidate : null;
};

export interface VerifiedPublicTurnstileResult {
  readonly success: true;
  readonly action: string;
  readonly hostname: string;
  readonly challengeTimestamp: string;
}

/**
 * Stable for a retry of the same one-time challenge, but different when an
 * ambiguous booking retry keeps its booking request ID and obtains a fresh
 * Turnstile token. Cloudflare requires Siteverify idempotency keys to be UUIDs.
 */
export async function publicTurnstileVerificationId(
  bookingRequestId: string,
  token: string,
): Promise<string> {
  if (!BOOKING_REQUEST_ID_PATTERN.test(bookingRequestId) || !token || token.length > TOKEN_MAX_LENGTH) {
    return rejected();
  }
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${VERIFICATION_ID_DOMAIN}\u0000${bookingRequestId}\u0000${token}`,
    ),
  ));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function verifyPublicBookingTurnstile(options: {
  readonly secret: string | undefined;
  readonly token: string;
  /**
   * Identifies this one Siteverify network operation. It must not be the
   * durable public-booking request ID: an ambiguous booking retry may carry a
   * fresh, one-time Turnstile token while retaining its booking idempotency.
   */
  readonly verificationId: string;
  readonly remoteIp?: string | null;
  readonly expectedHostname: string;
  readonly expectedAction?: string;
  readonly now: number;
  readonly providerFetch?: typeof fetch;
}): Promise<VerifiedPublicTurnstileResult> {
  const secret = options.secret?.trim() ?? "";
  if (!secret || secret.length > SECRET_MAX_LENGTH) return unconfigured();
  if (
    !options.token ||
    options.token.length > TOKEN_MAX_LENGTH ||
    options.token.trim() !== options.token ||
    !VERIFICATION_ID_PATTERN.test(options.verificationId) ||
    !Number.isFinite(options.now)
  ) return rejected();
  const expectedAction = options.expectedAction ?? "public_booking";
  if (
    !options.expectedHostname ||
    options.expectedHostname.length > 255 ||
    !expectedAction ||
    expectedAction.length > 64
  ) return unconfigured();

  const form = new URLSearchParams({
    secret,
    response: options.token,
    idempotency_key: options.verificationId,
  });
  const remoteIp = options.remoteIp?.trim() ?? "";
  if (remoteIp && IP_PATTERN.test(remoteIp)) form.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await (options.providerFetch ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
  } catch {
    return unavailable();
  }
  if (!response.ok) return unavailable();

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return unavailable();
  }
  if (!isRecord(result) || result.success !== true) return rejected();
  if (result.action !== expectedAction || result.hostname !== options.expectedHostname) {
    return rejected();
  }
  if (typeof result.challenge_ts !== "string" || result.challenge_ts.length > 64) {
    return rejected();
  }
  const challengedAt = Date.parse(result.challenge_ts);
  if (
    !Number.isFinite(challengedAt) ||
    challengedAt > options.now + MAX_FUTURE_SKEW_MS ||
    challengedAt < options.now - MAX_CHALLENGE_AGE_MS
  ) return rejected();
  return {
    success: true,
    action: result.action,
    hostname: result.hostname,
    challengeTimestamp: result.challenge_ts,
  };
}
