import { describe, expect, it } from "@rstest/core";
import {
  isPublicBookingResult,
  publicManagementTokenFromHash,
  PUBLIC_BOOKING_SCHEMA_VERSION,
} from "./contracts";

describe("public management capability contracts", () => {
  const token = `tapm_v1_${"a".repeat(43)}`;

  it("accepts the bearer only in a same-origin URL fragment", () => {
    const result = {
      schemaVersion: PUBLIC_BOOKING_SCHEMA_VERSION,
      status: "confirmed",
      bookingReference: "booking-reference-1234",
      startsAt: "2026-08-18T14:00:00.000Z",
      endsAt: "2026-08-18T14:30:00.000Z",
      managementUrl: `https://cal.with-tap.ai/manage#${token}`,
    };
    expect(isPublicBookingResult(result)).toBe(true);
    expect(isPublicBookingResult({
      ...result,
      managementUrl: `https://cal.with-tap.ai/manage/${token}`,
    })).toBe(false);
    expect(isPublicBookingResult({
      ...result,
      managementUrl: `https://evil.example/manage#${token}`,
    })).toBe(false);
  });

  it("parses only a versioned management fragment", () => {
    expect(publicManagementTokenFromHash(`#${token}`)).toBe(token);
    expect(publicManagementTokenFromHash(token)).toBe(token);
    expect(publicManagementTokenFromHash("#not-a-token")).toBeNull();
  });
});
