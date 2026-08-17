import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCalendarGatewayWorker,
} from "../src/index";
import { verifyPublicSlotToken } from "../src/public-booking-read";

const organizerOrigin = "http://localhost:3000";
const publicOrigin = "https://cal.with-tap.ai";
const workspace = "workspace-public-read";
const principal = "principal-public-read";
const connectionId = "connection-public-read";
const slotSigningKey = "public-slot-test-key-32-bytes-minimum-value";
const turnstileSiteKey = "1x00000000000000000000AA";
const turnstileSecret = "1x0000000000000000000000000000000AA";
const managementSecret = "public-management-test-secret-at-least-32-bytes";
const providerEvents = new Map<string, Readonly<Record<string, unknown>>>();
let providerInsertCalls = 0;
let turnstileAccepted = true;
let beforeNextProviderCommitAvailabilityResult: (() => Promise<void>) | null = null;

const encryptionKey = (): string => {
  let binary = "";
  for (let index = 0; index < 32; index += 1) {
    binary += String.fromCharCode(index + 1);
  }
  return btoa(binary);
};

const organizerRequest = (
  path: string,
  init: RequestInit & { readonly json?: unknown } = {},
): Request => {
  const headers = new Headers(init.headers);
  headers.set("Origin", organizerOrigin);
  headers.set("X-TAP-Workspace-Id", workspace);
  headers.set("X-TAP-Principal-Id", principal);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  return new Request(`https://calendar-api.theaiplatform.app${path}`, {
    ...init,
    headers,
    ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
  });
};

const publicRequest = (
  path: string,
  init: RequestInit & { readonly json?: unknown } = {},
): Request => {
  const requestHeaders = new Headers(init.headers);
  requestHeaders.set("Origin", publicOrigin);
  if (init.json !== undefined) requestHeaders.set("Content-Type", "application/json");
  return new Request(`https://calendar-api.theaiplatform.app${path}`, {
    ...init,
    headers: requestHeaders,
    ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
  });
};

type FreeBusyMode = "complete" | "incomplete" | "missing-busy" | "invalid-errors" | "wrong-bounds";

const providerFetch = (mode: () => FreeBusyMode): typeof fetch => async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.origin === "https://challenges.cloudflare.com" && url.pathname.endsWith("/siteverify")) {
    return Response.json(turnstileAccepted
      ? {
          success: true,
          action: "public_booking",
          hostname: "cal.with-tap.ai",
          challenge_ts: new Date().toISOString(),
        }
      : { success: false, "error-codes": ["invalid-input-response"] });
  }
  if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") {
    return Response.json({
      access_token: "public-read-access-token",
      refresh_token: "public-read-refresh-token",
      expires_in: 3_600,
      token_type: "Bearer",
    });
  }
  if (url.pathname === "/calendar/v3/users/me/calendarList") {
    return Response.json({
      items: [{
        id: "public-read@example.com",
        summary: "Public read primary",
        accessRole: "owner",
        primary: true,
        backgroundColor: "#6758e8",
      }],
    });
  }
  if (url.pathname === "/calendar/v3/freeBusy") {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = await request.clone().json<{
      readonly timeMin: string;
      readonly timeMax: string;
      readonly items: readonly { readonly id: string }[];
    }>();
    const currentMode = mode();
    return Response.json({
      timeMin: currentMode === "wrong-bounds" ? "2026-01-01T00:00:00.000Z" : body.timeMin,
      timeMax: body.timeMax,
      calendars: currentMode === "incomplete"
        ? {}
        : Object.fromEntries(body.items.map(item => [item.id,
            currentMode === "missing-busy"
              ? {}
              : currentMode === "invalid-errors"
                ? { busy: [], errors: "not-an-array" }
                : {
                    busy: [...providerEvents.values()].flatMap(event => {
                      const start = typeof event.start === "object" && event.start &&
                          "dateTime" in event.start && typeof event.start.dateTime === "string"
                        ? event.start.dateTime
                        : null;
                      const end = typeof event.end === "object" && event.end &&
                          "dateTime" in event.end && typeof event.end.dateTime === "string"
                        ? event.end.dateTime
                        : null;
                      return start && end && Date.parse(start) < Date.parse(body.timeMax) &&
                          Date.parse(end) > Date.parse(body.timeMin)
                        ? [{ start, end }]
                        : [];
                    }),
                  },
          ])),
    });
  }
  const eventMatch = url.pathname.match(/^\/calendar\/v3\/calendars\/[^/]+\/events(?:\/([^/]+))?$/u);
  if (eventMatch) {
    const eventId = eventMatch[1] ? decodeURIComponent(eventMatch[1]) : null;
    if (eventId && (init?.method ?? "GET") === "GET") {
      const event = providerEvents.get(eventId);
      return event
        ? Response.json(event)
        : Response.json({ error: { message: "Not found" } }, { status: 404 });
    }
    if (!eventId && init?.method === "POST") {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = await request.clone().json<Record<string, unknown>>();
      const id = typeof body.id === "string" ? body.id : "missing-id";
      const withConference = body.conferenceData
        ? {
            hangoutLink: "https://meet.google.com/public-route",
            conferenceData: {
              conferenceSolution: { key: { type: "hangoutsMeet" } },
              entryPoints: [{
                entryPointType: "video",
                uri: "https://meet.google.com/public-route",
              }],
            },
          }
        : {};
      const event = {
        ...body,
        ...withConference,
        id,
        status: "confirmed",
        updated: new Date().toISOString(),
        htmlLink: `https://calendar.google.com/event?eid=${id}`,
      };
      providerInsertCalls += 1;
      providerEvents.set(id, event);
      return Response.json(event);
    }
    if (!eventId && (init?.method ?? "GET") === "GET") {
      const beforeResult = beforeNextProviderCommitAvailabilityResult;
      beforeNextProviderCommitAvailabilityResult = null;
      if (beforeResult) await beforeResult();
      return Response.json({ items: [...providerEvents.values()] });
    }
  }
  return Response.json(
    { error: { message: `Unexpected provider request: ${url.href}` } },
    { status: 500 },
  );
};

const publicationPage = (calendarId: string, title = "30 minute meeting") => ({
  schemaVersion: "tap.calendar.publication.v1",
  sourceProfileId: "profile-public-read",
  profileSlug: "public-owner",
  displayName: "Public Owner",
  ownerType: "individual",
  sourceEventTypeId: "event-public-read",
  eventTypeSlug: "30min",
  title,
  description: "Pick a time that works.",
  durationMinutes: 30,
  approvalRequired: false,
  location: "google-meet",
  destinationCalendarId: calendarId,
  conflictCalendarIds: [calendarId],
  sourceAvailabilityScheduleId: "availability-public-read",
  schedule: {
    timeZone: "America/New_York",
    preferredStart: "09:00",
    preferredEnd: "17:00",
    bufferBeforeMinutes: 5,
    bufferAfterMinutes: 10,
    minimumNoticeMinutes: 0,
    bookingHorizonDays: 60,
    windows: Array.from({ length: 7 }, (_, day) => ({
      day,
      enabled: true,
      start: "09:00",
      end: "17:00",
    })),
    overrides: [],
  },
});

describe("anonymous public booking reads", () => {
  let freeBusyMode: FreeBusyMode;
  const workerEnv = () => ({
    ...env,
    TOKEN_ENCRYPTION_KEY: encryptionKey(),
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    PUBLIC_TURNSTILE_SITE_KEY: turnstileSiteKey,
    PUBLIC_BOOKING_SLOT_SIGNING_KEY: slotSigningKey,
    TURNSTILE_SECRET_KEY: turnstileSecret,
    PUBLIC_BOOKING_MANAGEMENT_SECRET: managementSecret,
  });
  const worker = createCalendarGatewayWorker(providerFetch(() => freeBusyMode));

  beforeEach(async () => {
    freeBusyMode = "complete";
    turnstileAccepted = true;
    beforeNextProviderCommitAvailabilityResult = null;
    providerInsertCalls = 0;
    providerEvents.clear();
    await env.CALENDAR_DB.batch([
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_email_outbox"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_mutations"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_credentials"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_slot_proof_uses"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_attempts"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_owner_leases"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_publication_audit"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_page_revisions"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_page_slugs"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_pages"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_profile_generations"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_profile_slugs"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_owner_profile_slots"),
      env.CALENDAR_DB.prepare("DELETE FROM public_booking_profiles"),
      env.CALENDAR_DB.prepare("DELETE FROM provider_booking_resolutions"),
      env.CALENDAR_DB.prepare("DELETE FROM provider_booking_commit_locks"),
      env.CALENDAR_DB.prepare("DELETE FROM provider_booking_commits"),
      env.CALENDAR_DB.prepare("DELETE FROM provider_calendars"),
      env.CALENDAR_DB.prepare("DELETE FROM calendar_connections"),
    ]);
  });

  const connectAndPublish = async (options: {
    readonly minimumNoticeMinutes?: number;
  } = {}): Promise<{
    readonly calendarId: string;
    readonly revisionId: string;
  }> => {
    const runtimeEnv = workerEnv();
    const started = await worker.fetch(organizerRequest("/v1/oauth/google/start", {
      method: "POST",
      json: { id: connectionId, label: "Public Google" },
    }), runtimeEnv);
    expect(started.status).toBe(201);
    const authorizationUrl = (await started.json<{ authorizationUrl: string }>()).authorizationUrl;
    const state = new URL(authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();
    const callback = await worker.fetch(organizerRequest(
      `/v1/oauth/google/callback?state=${encodeURIComponent(state!)}&code=authorization-code`,
    ), runtimeEnv);
    expect(callback.status).toBe(200);
    const calendarId = await env.CALENDAR_DB.prepare(
      "SELECT id FROM provider_calendars WHERE connection_id = ?",
    ).bind(connectionId).first<string>("id");
    expect(calendarId).toBeTruthy();
    const published = await worker.fetch(organizerRequest("/v1/publications/profiles", {
      method: "POST",
      json: {
        schemaVersion: "tap.calendar.profile-publication.v1",
        expectedGeneration: 0,
        publications: [{
          ...publicationPage(calendarId!),
          schedule: {
            ...publicationPage(calendarId!).schedule,
            minimumNoticeMinutes: options.minimumNoticeMinutes ?? 0,
          },
        }],
      },
    }), runtimeEnv);
    expect(published.status).toBe(200);
    const receipt = await published.json<{
      publication: { pages: readonly { revisionId: string }[] };
    }>();
    return { calendarId: calendarId!, revisionId: receipt.publication.pages[0]!.revisionId };
  };

  it("resolves an anonymous guest-safe page and ignores spoofed TAP identity headers", async () => {
    const { calendarId, revisionId } = await connectAndPublish();
    const response = await worker.fetch(publicRequest(
      "/api/public/pages/public-owner/30min",
      { headers: {
        "X-TAP-Workspace-Id": "spoofed-workspace",
        "X-TAP-Principal-Id": "spoofed-principal",
      } },
    ), workerEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(publicOrigin);
    const page = await response.json<Record<string, unknown>>();
    expect(page).toMatchObject({
      schemaVersion: "tap.calendar.public-page.v1",
      pageRevision: revisionId,
      canonicalUrl: "https://cal.with-tap.ai/public-owner/30min",
      profile: { displayName: "Public Owner" },
      eventType: { title: "30 minute meeting", durationMinutes: 30 },
      turnstile: { siteKey: turnstileSiteKey },
    });
    expect(JSON.stringify(page)).not.toContain(calendarId);
    expect(JSON.stringify(page)).not.toContain(workspace);
    expect(JSON.stringify(page)).not.toContain(principal);
  });

  it("returns signed availability only when every Google calendar is conclusive", async () => {
    const { revisionId } = await connectAndPublish();
    const path = "/api/public/pages/public-owner/30min/availability" +
      `?month=2026-08-01&timeZone=America%2FNew_York&pageRevision=${encodeURIComponent(revisionId)}`;
    const response = await worker.fetch(publicRequest(path), workerEnv());
    expect(response.status).toBe(200);
    const availability = await response.json<{
      pageRevision: string;
      dates: readonly { date: string; slots: readonly { start: string; end: string; token: string }[] }[];
    }>();
    expect(availability.pageRevision).toBe(revisionId);
    const firstSlot = availability.dates.flatMap(date => date.slots)[0];
    expect(firstSlot).toBeTruthy();
    await expect(verifyPublicSlotToken(slotSigningKey, firstSlot!.token, {
      now: Date.now(),
    })).resolves.toEqual(expect.objectContaining({
      v: 1,
      revisionId,
      start: firstSlot!.start,
      end: firstSlot!.end,
    }));
    expect(atob(firstSlot!.token.split(".")[0]!.replaceAll("-", "+").replaceAll("_", "/")))
      .not.toMatch(/workspace|principal|calendar/u);

    freeBusyMode = "incomplete";
    const unavailable = await worker.fetch(publicRequest(path), workerEnv());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: "public_availability_unavailable",
      message: "Availability could not be checked. Try again shortly.",
      retryable: true,
    });

    for (const invalidMode of ["missing-busy", "invalid-errors", "wrong-bounds"] as const) {
      freeBusyMode = invalidMode;
      const malformed = await worker.fetch(publicRequest(path), workerEnv());
      expect(malformed.status).toBe(503);
      expect(await malformed.json()).toMatchObject({
        error: "public_availability_unavailable",
        retryable: true,
      });
    }
  });

  it("creates one real provider booking, replays it idempotently, and stores only the management-token hash", async () => {
    const { revisionId } = await connectAndPublish();
    const availabilityPath = "/api/public/pages/public-owner/30min/availability" +
      `?month=2026-08-01&timeZone=America%2FNew_York&pageRevision=${encodeURIComponent(revisionId)}`;
    const availabilityResponse = await worker.fetch(
      publicRequest(availabilityPath),
      workerEnv(),
    );
    expect(availabilityResponse.status).toBe(200);
    const availability = await availabilityResponse.json<{
      dates: readonly {
        date: string;
        slots: readonly { start: string; end: string; token: string }[];
      }[];
    }>();
    const slot = availability.dates.flatMap(date => date.slots)[0];
    expect(slot).toBeTruthy();

    const body = {
      schemaVersion: "tap.calendar.public-booking.v1",
      requestId: "e3ffdb18-f66b-4d68-b96a-7907461a78f4",
      slotToken: slot!.token,
      guest: {
        name: "  Guest   Person  ",
        email: "Guest@example.com",
      },
      turnstileToken: "turnstile-public-booking-test",
    };
    const path = "/api/public/pages/public-owner/30min/bookings";
    const first = await worker.fetch(publicRequest(path, {
      method: "POST",
      headers: {
        "X-TAP-Workspace-Id": "spoofed-workspace",
        "X-TAP-Principal-Id": "spoofed-principal",
      },
      json: body,
    }), workerEnv());
    expect(first.status).toBe(201);
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe(publicOrigin);
    const result = await first.json<{
      schemaVersion: string;
      status: string;
      bookingReference: string;
      startsAt: string;
      endsAt: string;
      managementUrl: string;
    }>();
    expect(result).toMatchObject({
      schemaVersion: "tap.calendar.public-booking.v1",
      status: "confirmed",
      startsAt: slot!.start,
      endsAt: slot!.end,
    });
    expect(result.bookingReference).toMatch(/^[A-Za-z0-9_-]{16,128}$/u);
    expect(result.managementUrl).toMatch(/^https:\/\/cal\.with-tap\.ai\/manage#tapm_v1_[A-Za-z0-9_-]+$/u);
    expect(JSON.stringify(result)).not.toMatch(/workspace-public-read|principal-public-read|public-read@example\.com/u);
    expect(providerInsertCalls).toBe(1);

    const managementToken = new URL(result.managementUrl).pathname.split("/").at(-1)!;
    const credential = await env.CALENDAR_DB.prepare(
      `SELECT token_hash, guest_name, guest_email
         FROM public_booking_management_credentials
        WHERE booking_reference = ?`,
    ).bind(result.bookingReference).first<{
      token_hash: string;
      guest_name: string;
      guest_email: string;
    }>();
    expect(credential).toMatchObject({
      guest_name: "Guest   Person",
      guest_email: "guest@example.com",
    });
    expect(credential!.token_hash).not.toBe(managementToken);
    expect(credential!.token_hash).not.toContain(managementToken);
    const storedResponse = await env.CALENDAR_DB.prepare(
      `SELECT response_json FROM public_booking_attempts
        WHERE idempotency_key = ?`,
    ).bind(body.requestId).first<string>("response_json");
    expect(storedResponse).not.toContain(managementToken);

    const replay = await worker.fetch(publicRequest(path, {
      method: "POST",
      json: body,
    }), workerEnv());
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(result);
    expect(providerInsertCalls).toBe(1);

    turnstileAccepted = false;
    const rejected = await worker.fetch(publicRequest(path, {
      method: "POST",
      json: {
        ...body,
        requestId: "c7db07d6-74aa-4e06-92c1-cd2f06d466c7",
      },
    }), workerEnv());
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ error: "turnstile_failed" });
    expect(providerInsertCalls).toBe(1);
  });

  it("rejects an issued slot when minimum notice elapses before the booking POST", async () => {
    vi.useFakeTimers();
    try {
      const issuedAt = Date.parse("2026-08-16T12:00:00.000Z");
      vi.setSystemTime(issuedAt);
      const { revisionId } = await connectAndPublish({ minimumNoticeMinutes: 1_500 });
      const availabilityPath = "/api/public/pages/public-owner/30min/availability" +
        `?month=2026-08-01&timeZone=UTC&pageRevision=${encodeURIComponent(revisionId)}`;
      const availabilityResponse = await worker.fetch(
        publicRequest(availabilityPath),
        workerEnv(),
      );
      expect(availabilityResponse.status).toBe(200);
      const availability = await availabilityResponse.json<{
        dates: readonly {
          slots: readonly { start: string; end: string; token: string }[];
        }[];
      }>();
      const slot = availability.dates.flatMap(date => date.slots)
        .find(candidate => candidate.start === "2026-08-17T13:00:00.000Z");
      expect(slot).toBeDefined();

      vi.setSystemTime(issuedAt + 60_000);
      const rejected = await worker.fetch(publicRequest(
        "/api/public/pages/public-owner/30min/bookings",
        {
          method: "POST",
          json: {
            schemaVersion: "tap.calendar.public-booking.v1",
            requestId: "0371e771-56ef-423a-bf7f-3864f9be7260",
            slotToken: slot!.token,
            guest: { name: "Notice Guest", email: "notice@example.com" },
            turnstileToken: "turnstile-public-booking-notice-test",
          },
        },
      ), workerEnv());

      expect(rejected.status).toBe(409);
      expect(await rejected.json()).toMatchObject({ error: "slot_conflict" });
      expect(providerInsertCalls).toBe(0);
      expect(await env.CALENDAR_DB.prepare(
        "SELECT COUNT(*) AS count FROM public_booking_attempts",
      ).first<number>("count")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not create an event when the page is unpublished and republished during locked provider I/O", async () => {
    const { calendarId, revisionId } = await connectAndPublish();
    const availabilityPath = "/api/public/pages/public-owner/30min/availability" +
      `?month=2026-08-01&timeZone=America%2FNew_York&pageRevision=${encodeURIComponent(revisionId)}`;
    const availabilityResponse = await worker.fetch(
      publicRequest(availabilityPath),
      workerEnv(),
    );
    expect(availabilityResponse.status).toBe(200);
    const availability = await availabilityResponse.json<{
      dates: readonly {
        date: string;
        slots: readonly { start: string; end: string; token: string }[];
      }[];
    }>();
    const slot = availability.dates.flatMap(date => date.slots)[0];
    expect(slot).toBeTruthy();

    beforeNextProviderCommitAvailabilityResult = async () => {
      const unpublished = await worker.fetch(organizerRequest(
        "/v1/publications/profiles/unpublish",
        {
          method: "POST",
          json: {
            schemaVersion: "tap.calendar.profile-unpublication.v1",
            sourceProfileId: "profile-public-read",
            expectedGeneration: 1,
          },
        },
      ), workerEnv());
      expect(unpublished.status).toBe(200);
      const republished = await worker.fetch(organizerRequest("/v1/publications/profiles", {
        method: "POST",
        json: {
          schemaVersion: "tap.calendar.profile-publication.v1",
          expectedGeneration: 2,
          publications: [publicationPage(calendarId, "Republished during provider I/O")],
        },
      }), workerEnv());
      expect(republished.status).toBe(200);
    };

    const result = await worker.fetch(publicRequest(
      "/api/public/pages/public-owner/30min/bookings",
      {
        method: "POST",
        json: {
          schemaVersion: "tap.calendar.public-booking.v1",
          requestId: "67b9d940-c25a-4f37-8a82-b8ba4be69e5a",
          slotToken: slot!.token,
          guest: { name: "Revision Fence Guest", email: "fence@example.com" },
          turnstileToken: "turnstile-public-booking-revision-fence",
        },
      },
    ), workerEnv());

    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      error: "provider_commit_uncertain",
      retryable: true,
    });
    expect(providerInsertCalls).toBe(0);
    expect(providerEvents.size).toBe(0);
    expect(await env.CALENDAR_DB.prepare(
      `SELECT COUNT(*) AS count
         FROM provider_booking_commits
        WHERE workspace_id = ? AND principal_id = ?
          AND state = 'rejected' AND last_error_code = 'public_page_changed'`,
    ).bind(workspace, principal).first<number>("count")).toBe(1);
    expect(await env.CALENDAR_DB.prepare(
      `SELECT COUNT(*) AS count
         FROM provider_booking_commits
        WHERE workspace_id = ? AND principal_id = ? AND state = 'pending'`,
    ).bind(workspace, principal).first<number>("count")).toBe(0);
    const currentRevision = await env.CALENDAR_DB.prepare(
      `SELECT current_revision_id
         FROM public_booking_pages
        WHERE source_event_type_id = 'event-public-read'`,
    ).first<string>("current_revision_id");
    expect(currentRevision).toBeTruthy();
    expect(currentRevision).not.toBe(revisionId);
  });

  it("rejects stale revisions and hides unpublished or malformed public routes", async () => {
    const { calendarId, revisionId } = await connectAndPublish();
    const republished = await worker.fetch(organizerRequest("/v1/publications/profiles", {
      method: "POST",
      json: {
        schemaVersion: "tap.calendar.profile-publication.v1",
        expectedGeneration: 1,
        publications: [publicationPage(calendarId, "Updated meeting")],
      },
    }), workerEnv());
    expect(republished.status).toBe(200);
    const stale = await worker.fetch(publicRequest(
      "/api/public/pages/public-owner/30min/availability" +
      `?month=2026-08-01&timeZone=UTC&pageRevision=${encodeURIComponent(revisionId)}`,
    ), workerEnv());
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: "public_page_changed",
      retryable: true,
    });

    const unpublished = await worker.fetch(organizerRequest(
      "/v1/publications/profiles/unpublish",
      {
        method: "POST",
        json: {
          schemaVersion: "tap.calendar.profile-unpublication.v1",
          sourceProfileId: "profile-public-read",
          expectedGeneration: 2,
        },
      },
    ), workerEnv());
    expect(unpublished.status).toBe(200);
    const missing = await worker.fetch(publicRequest(
      "/api/public/pages/public-owner/30min",
    ), workerEnv());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "public_page_unavailable",
      message: "This booking page is unavailable.",
    });

    const malformed = await worker.fetch(publicRequest(
      "/api/public/pages/Public-Owner/30min",
    ), workerEnv());
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual({
      error: "public_page_unavailable",
      message: "This booking page is unavailable.",
    });
  });
});
