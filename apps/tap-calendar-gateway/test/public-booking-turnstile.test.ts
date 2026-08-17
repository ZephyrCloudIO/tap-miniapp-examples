import { describe, expect, it, vi } from "vitest";
import {
  publicClientIp,
  publicTurnstileVerificationId,
  PublicTurnstileError,
  verifyPublicBookingTurnstile,
} from "../src/public-booking-turnstile";

const now = Date.parse("2026-08-16T18:00:00.000Z");
const bookingRequestId = "a7c8ef3b-b859-462f-8825-b5c09b4a6512";
const verificationId = "1ed83532-47ff-48b9-b3da-07d8e7434962";

const siteverify = (body: unknown, status = 200): typeof fetch =>
  vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;

const verify = (overrides: Partial<Parameters<typeof verifyPublicBookingTurnstile>[0]> = {}) =>
  verifyPublicBookingTurnstile({
    secret: "turnstile-secret",
    token: "turnstile-response",
    verificationId,
    remoteIp: "203.0.113.10",
    expectedHostname: "cal.with-tap.ai",
    now,
    providerFetch: siteverify({
      success: true,
      action: "public_booking",
      hostname: "cal.with-tap.ai",
      challenge_ts: "2026-08-16T17:59:00.000Z",
    }),
    ...overrides,
  });

describe("public booking Turnstile verification", () => {
  it("deduplicates one challenge retry without coupling fresh challenges", async () => {
    const first = await publicTurnstileVerificationId(bookingRequestId, "turnstile-response");
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    await expect(publicTurnstileVerificationId(bookingRequestId, "turnstile-response"))
      .resolves.toBe(first);
    await expect(publicTurnstileVerificationId(bookingRequestId, "fresh-turnstile-response"))
      .resolves.not.toBe(first);
  });

  it("accepts the same UUID versions as the public booking request parser", async () => {
    const value = await publicTurnstileVerificationId(
      "018f9f7e-b9da-7b53-89e2-0f10a143c112",
      "turnstile-response",
    );
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it("submits the server secret, one-time token, IP, action, and idempotency key", async () => {
    const providerFetch = siteverify({
      success: true,
      action: "public_booking",
      hostname: "cal.with-tap.ai",
      challenge_ts: "2026-08-16T17:59:00.000Z",
    });
    await verify({ providerFetch });
    expect(providerFetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(providerFetch).mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const form = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(form)).toEqual({
      secret: "turnstile-secret",
      response: "turnstile-response",
      idempotency_key: verificationId,
      remoteip: "203.0.113.10",
    });
  });

  it.each([
    [{ success: false, "error-codes": ["timeout-or-duplicate"] }, "turnstile_failed"],
    [{ success: true, action: "other", hostname: "cal.with-tap.ai", challenge_ts: "2026-08-16T17:59:00Z" }, "turnstile_failed"],
    [{ success: true, action: "public_booking", hostname: "evil.example", challenge_ts: "2026-08-16T17:59:00Z" }, "turnstile_failed"],
    [{ success: true, action: "public_booking", hostname: "cal.with-tap.ai", challenge_ts: "2026-08-16T17:30:00Z" }, "turnstile_failed"],
  ])("rejects a failed, mismatched, or stale challenge", async (body, code) => {
    await expect(verify({ providerFetch: siteverify(body) })).rejects.toMatchObject({
      status: 403,
      code,
      retryable: false,
    } satisfies Partial<PublicTurnstileError>);
  });

  it("fails retryably when Siteverify is unavailable or malformed", async () => {
    await expect(verify({ providerFetch: siteverify({ error: true }, 502) }))
      .rejects.toMatchObject({ status: 503, code: "turnstile_unavailable", retryable: true });
    await expect(verify({ providerFetch: vi.fn(async () => new Response("not-json")) as unknown as typeof fetch }))
      .rejects.toMatchObject({ status: 503, code: "turnstile_unavailable", retryable: true });
  });

  it("fails closed when the server secret is absent", async () => {
    await expect(verify({ secret: undefined })).rejects.toMatchObject({
      status: 503,
      code: "public_booking_unconfigured",
      retryable: true,
    });
  });

  it("only forwards a syntactically safe Cloudflare client IP", () => {
    expect(publicClientIp(new Request("https://example.test", {
      headers: { "CF-Connecting-IP": "2001:db8::1" },
    }))).toBe("2001:db8::1");
    expect(publicClientIp(new Request("https://example.test", {
      headers: { "CF-Connecting-IP": "203.0.113.7, 10.0.0.1" },
    }))).toBeNull();
  });
});
