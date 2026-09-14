import { describe, expect, it } from "@rstest/core";
import {
  isPublicBookingProfile,
  isPublicBookingResult,
  publicManagementTokenFromHash,
  PUBLIC_BOOKING_SCHEMA_VERSION,
  PUBLIC_PROFILE_SCHEMA_VERSION,
} from "./contracts";

describe("public booking profile contracts", () => {
  const eventType = {
    eventTypeSlug: "30min",
    canonicalUrl: "https://cal.with-tap.ai/alex-morgan/30min",
    title: "30 minute meeting",
    description: "A quick conversation.",
    durationMinutes: 30,
    location: "google-meet",
    locationLabel: "Google Meet",
    approvalRequired: false,
  };
  const profile = {
    schemaVersion: PUBLIC_PROFILE_SCHEMA_VERSION,
    canonicalUrl: "https://cal.with-tap.ai/alex-morgan",
    profile: { displayName: "Alex Morgan", initials: "AM" },
    eventTypes: [eventType],
  };

  it("accepts claimed profiles with or without active event types", () => {
    expect(isPublicBookingProfile(profile, "alex-morgan")).toBe(true);
    expect(isPublicBookingProfile({ ...profile, eventTypes: [] }, "alex-morgan")).toBe(true);
  });

  it("requires unique event slugs and exact same-origin canonical links", () => {
    expect(isPublicBookingProfile({
      ...profile,
      eventTypes: [eventType, eventType],
    }, "alex-morgan")).toBe(false);
    expect(isPublicBookingProfile({
      ...profile,
      canonicalUrl: "https://evil.example/alex-morgan",
    }, "alex-morgan")).toBe(false);
    expect(isPublicBookingProfile({
      ...profile,
      eventTypes: [{
        ...eventType,
        canonicalUrl: "https://cal.with-tap.ai/alex-morgan/another-event",
      }],
    }, "alex-morgan")).toBe(false);
  });
});

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
