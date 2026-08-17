export interface PublicBookingRateLimiter {
  limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>;
}

export class PublicBookingRateLimitError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "PublicBookingRateLimitError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const boundedActor = (request: Request): string => {
  const ip = request.headers.get("CF-Connecting-IP")?.trim() ?? "";
  return /^[0-9a-f:.]{2,64}$/iu.test(ip) ? ip : "unknown-client";
};

export async function enforcePublicBookingRateLimit(options: {
  readonly limiter: PublicBookingRateLimiter | undefined;
  readonly localDevelopment: boolean;
  readonly request: Request;
  readonly resource: string;
}): Promise<void> {
  if (!options.limiter) {
    if (options.localDevelopment) return;
    throw new PublicBookingRateLimitError(
      503,
      "public_booking_unconfigured",
      "Public booking protection is not configured.",
      true,
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${options.resource}\u0000${boundedActor(options.request)}`),
  );
  const { success } = await options.limiter.limit({
    // Keep raw IP addresses out of the rate-limiter key while retaining a
    // page-specific actor boundary.
    key: base64Url(new Uint8Array(digest)),
  });
  if (!success) {
    throw new PublicBookingRateLimitError(
      429,
      "public_rate_limited",
      "Too many booking requests. Wait a moment and try again.",
      true,
    );
  }
}
