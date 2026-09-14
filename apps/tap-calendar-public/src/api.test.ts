import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  cancelPublicBookingManagement,
  createPublicBooking,
  loadPublicBookingManagement,
  loadPublicBookingProfile,
  loadPublicAvailability,
  loadPublicBookingPage,
  PublicCalendarApiError,
} from "./api";
import {
  PUBLIC_AVAILABILITY_SCHEMA_VERSION,
  PUBLIC_BOOKING_SCHEMA_VERSION,
  PUBLIC_MANAGEMENT_CANCEL_SCHEMA_VERSION,
  PUBLIC_MANAGEMENT_SCHEMA_VERSION,
  PUBLIC_PAGE_SCHEMA_VERSION,
  PUBLIC_PROFILE_SCHEMA_VERSION,
} from "./contracts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  Reflect.set(globalThis, "fetch", originalFetch);
});

describe("public Calendar API client", () => {
  const managementToken = `tapm_v1_${"a".repeat(43)}`;
  const management = {
    schemaVersion: PUBLIC_MANAGEMENT_SCHEMA_VERSION,
    bookingVersion: 1,
    bookingReference: "booking-reference-1234",
    status: "confirmed" as const,
    guest: { name: "Guest", email: "guest@example.com" },
    host: { displayName: "Alex" },
    event: {
      title: "30 minute meeting",
      startsAt: "2026-08-18T14:00:00.000Z",
      endsAt: "2026-08-18T14:30:00.000Z",
      durationMinutes: 30,
      location: "google-meet" as const,
      locationLabel: "Google Meet",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      approvalExpiresAt: null,
    },
    actions: { canCancel: true, canReschedule: true },
    reschedulePage: {
      profileSlug: "alex-morgan",
      eventTypeSlug: "30min",
      pageRevision: "revision-1",
      bookingWindow: { firstDate: "2026-08-16", lastDate: "2026-10-15" },
      turnstileSiteKey: "site-key",
    },
  };

  it("loads an empty claimed profile anonymously", async () => {
    const profile = {
      schemaVersion: PUBLIC_PROFILE_SCHEMA_VERSION,
      canonicalUrl: "https://cal.with-tap.ai/alex-morgan",
      profile: { displayName: "Alex Morgan", initials: "AM" },
      eventTypes: [],
    };
    const fetchMock = rs.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(profile), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    Reflect.set(globalThis, "fetch", fetchMock);

    await expect(loadPublicBookingProfile("alex-morgan")).resolves.toEqual(profile);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/profiles/alex-morgan",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("uses slug-safe anonymous URLs and omits credentials", async () => {
    const page = {
      schemaVersion: PUBLIC_PAGE_SCHEMA_VERSION,
      pageRevision: "revision-1",
      canonicalUrl: "https://cal.with-tap.ai/alex-morgan/30min",
      profile: { displayName: "Alex Morgan", initials: "AM" },
      eventType: {
        title: "30 minute meeting",
        durationMinutes: 30,
        location: "google-meet" as const,
        locationLabel: "Google Meet",
        approvalRequired: false,
      },
      bookingWindow: { firstDate: "2026-08-16", lastDate: "2026-10-15" },
      turnstile: { siteKey: "site-key" },
    };
    const fetchMock = rs.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    Reflect.set(globalThis, "fetch", fetchMock);

    await expect(loadPublicBookingPage("alex-morgan", "30min")).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/pages/alex-morgan/30min",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("binds slot requests to the displayed page revision", async () => {
    const body = {
      schemaVersion: PUBLIC_AVAILABILITY_SCHEMA_VERSION,
      pageRevision: "revision-1",
      viewerTimeZone: "America/Los_Angeles",
      month: "2026-08-01",
      generatedAt: "2026-08-16T12:00:00.000Z",
      expiresAt: "2026-08-16T12:05:00.000Z",
      dates: [],
    };
    const fetchMock = rs.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    Reflect.set(globalThis, "fetch", fetchMock);

    await loadPublicAvailability({
      profileSlug: "alex-morgan",
      eventTypeSlug: "30min",
      month: "2026-08-01",
      viewerTimeZone: "America/Los_Angeles",
      pageRevision: "revision-1",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/public/pages/alex-morgan/30min/availability?month=2026-08-01&timeZone=America%2FLos_Angeles&pageRevision=revision-1",
    );
  });

  it("preserves the public_page_changed code so the UI can reload", async () => {
    Reflect.set(globalThis, "fetch", rs.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        error: "public_page_changed",
        message: "This booking page changed. Reload it and choose a new time.",
        retryable: true,
      }),
      { status: 409 },
    )));

    await expect(loadPublicAvailability({
      profileSlug: "alex-morgan",
      eventTypeSlug: "30min",
      month: "2026-08-01",
      viewerTimeZone: "America/Los_Angeles",
      pageRevision: "revision-1",
    })).rejects.toMatchObject({
      code: "public_page_changed",
      status: 409,
      retryable: true,
    } satisfies Partial<PublicCalendarApiError>);
  });

  it("returns a valid changed revision so the UI can replace the page", async () => {
    const changed = {
      schemaVersion: PUBLIC_AVAILABILITY_SCHEMA_VERSION,
      pageRevision: "revision-2",
      viewerTimeZone: "America/Los_Angeles",
      month: "2026-08-01",
      generatedAt: "2026-08-16T12:00:00.000Z",
      expiresAt: "2026-08-16T12:05:00.000Z",
      dates: [],
    };
    Reflect.set(globalThis, "fetch", rs.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(changed), { status: 200 }),
    ));

    await expect(loadPublicAvailability({
      profileSlug: "alex-morgan",
      eventTypeSlug: "30min",
      month: "2026-08-01",
      viewerTimeZone: "America/Los_Angeles",
      pageRevision: "revision-1",
    })).resolves.toEqual(changed);
  });

  it("preserves safe server errors without leaking non-JSON proxy bodies", async () => {
    Reflect.set(globalThis, "fetch", rs.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: "page_not_found", message: "This booking page is unavailable." }),
      { status: 404 },
    )));
    await expect(loadPublicBookingPage("missing", "page")).rejects.toMatchObject({
      name: "PublicCalendarApiError",
      code: "page_not_found",
      status: 404,
    } satisfies Partial<PublicCalendarApiError>);
  });

  it("does not trust malformed error bodies", async () => {
    Reflect.set(globalThis, "fetch", rs.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: "internal_secret", message: { private: "do not render" } }),
      { status: 500 },
    )));
    await expect(loadPublicBookingPage("alex-morgan", "30min")).rejects.toMatchObject({
      code: "http_500",
      message: "TAP Calendar could not complete the request.",
      retryable: true,
    });
  });

  it("rejects malformed public DTOs and off-origin management links", async () => {
    Reflect.set(globalThis, "fetch", rs.fn<typeof fetch>().mockResolvedValueOnce(new Response(
      JSON.stringify({ schemaVersion: PUBLIC_PAGE_SCHEMA_VERSION, canonicalUrl: "https://evil.example/page" }),
      { status: 200 },
    )));
    await expect(loadPublicBookingPage("alex-morgan", "30min")).rejects.toMatchObject({
      code: "public_response_invalid",
      status: 502,
    });

    Reflect.set(globalThis, "fetch", rs.fn<typeof fetch>().mockResolvedValueOnce(new Response(
      JSON.stringify({
        schemaVersion: PUBLIC_BOOKING_SCHEMA_VERSION,
        status: "confirmed",
        bookingReference: "booking-1",
        startsAt: "2026-08-18T14:00:00.000Z",
        endsAt: "2026-08-18T14:30:00.000Z",
        managementUrl: "https://evil.example/manage/stolen-token-123456789",
      }),
      { status: 200 },
    )));
    await expect(createPublicBooking({
      profileSlug: "alex-morgan",
      eventTypeSlug: "30min",
      request: {
        schemaVersion: PUBLIC_BOOKING_SCHEMA_VERSION,
        requestId: "request-1",
        slotToken: "slot-token-123456789",
        guest: { name: "Guest", email: "guest@example.com" },
        turnstileToken: "turnstile-token",
      },
    })).rejects.toMatchObject({ code: "public_response_invalid" });
  });

  it("keeps management bearers out of request URLs and sends them only in Authorization", async () => {
    const fetchMock = rs.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(management), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...management,
        bookingVersion: 2,
        status: "cancelled",
        actions: { canCancel: false, canReschedule: false },
        reschedulePage: null,
      }), { status: 200 }));
    Reflect.set(globalThis, "fetch", fetchMock);

    await expect(loadPublicBookingManagement(managementToken)).resolves.toEqual(management);
    await expect(cancelPublicBookingManagement({
      token: managementToken,
      request: {
        schemaVersion: PUBLIC_MANAGEMENT_CANCEL_SCHEMA_VERSION,
        requestId: "39a320c7-20b7-4cca-b0e4-c3f7a93f1db7",
        expectedVersion: 1,
      },
    })).resolves.toMatchObject({ status: "cancelled", bookingVersion: 2 });

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      "/api/public/manage",
      "/api/public/manage/cancel",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${managementToken}`);
      expect(String(init?.body ?? "")).not.toContain(managementToken);
      expect(init).toEqual(expect.objectContaining({ credentials: "omit" }));
    }
  });
});
