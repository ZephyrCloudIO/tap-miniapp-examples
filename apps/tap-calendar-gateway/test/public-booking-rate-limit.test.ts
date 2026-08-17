import { describe, expect, it } from "vitest";
import {
  enforcePublicBookingRateLimit,
  type PublicBookingRateLimiter,
} from "../src/public-booking-rate-limit";

const request = (ip = "203.0.113.9") => new Request("https://calendar-api.theaiplatform.app/api/public/pages/a/b", {
  headers: { "CF-Connecting-IP": ip },
});

describe("public booking rate limits", () => {
  it("uses an opaque page-and-actor key", async () => {
    const keys: string[] = [];
    const limit: PublicBookingRateLimiter["limit"] = async ({ key }) => {
      keys.push(key);
      return { success: true };
    };
    await enforcePublicBookingRateLimit({
      limiter: { limit },
      localDevelopment: false,
      request: request(),
      resource: "availability:a/b",
    });
    const key = keys[0];
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(key).not.toContain("203.0.113.9");
    expect(key).not.toContain("a/b");
  });

  it("returns a retryable 429 after the binding rejects the request", async () => {
    const limiter: PublicBookingRateLimiter = { limit: async () => ({ success: false }) };
    await expect(enforcePublicBookingRateLimit({
      limiter,
      localDevelopment: false,
      request: request(),
      resource: "booking:a/b",
    })).rejects.toMatchObject({
      status: 429,
      code: "public_rate_limited",
      retryable: true,
    });
  });

  it("allows a missing binding only in explicit local development", async () => {
    await expect(enforcePublicBookingRateLimit({
      limiter: undefined,
      localDevelopment: true,
      request: request(),
      resource: "availability:a/b",
    })).resolves.toBeUndefined();
    await expect(enforcePublicBookingRateLimit({
      limiter: undefined,
      localDevelopment: false,
      request: request(),
      resource: "availability:a/b",
    })).rejects.toMatchObject({ status: 503, code: "public_booking_unconfigured" });
  });
});
