import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createCalendarGatewayWorker } from "../src/index";
const worker = createCalendarGatewayWorker();

const now = "2026-08-16T18:00:00.000Z";
const workspace = "workspace-public-route";
const principal = "user-public-route";

const publicationPage = (title = "30 minute meeting") => ({
  schemaVersion: "tap.calendar.publication.v1",
  sourceProfileId: "profile-route-1",
  profileSlug: "route-owner",
  displayName: "Route Owner",
  ownerType: "individual",
  sourceEventTypeId: "event-route-1",
  eventTypeSlug: "30min",
  title,
  description: "Pick a time.",
  durationMinutes: 30,
  approvalRequired: false,
  location: "google-meet",
  destinationCalendarId: "calendar-route-primary",
  conflictCalendarIds: ["calendar-route-primary"],
  sourceAvailabilityScheduleId: "availability-route-1",
  schedule: {
    timeZone: "America/New_York",
    preferredStart: "09:00",
    preferredEnd: "17:00",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minimumNoticeMinutes: 120,
    bookingHorizonDays: 60,
    windows: [{ day: 1, enabled: true, start: "09:00", end: "17:00" }],
    overrides: [],
  },
});

const profilePublication = (
  expectedGeneration = 0,
  publications: readonly Record<string, unknown>[] = [publicationPage()],
) => ({
  schemaVersion: "tap.calendar.profile-publication.v1",
  sourceProfileId: "profile-route-1",
  profileSlug: "route-owner",
  displayName: "Route Owner",
  ownerType: "individual",
  expectedGeneration,
  publications,
});

const request = (path: string, body: unknown) => new Request(
  `https://calendar-api.theaiplatform.app${path}`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      "X-TAP-Principal-Id": principal,
      "X-TAP-Workspace-Id": workspace,
    },
    body: JSON.stringify(body),
  },
);

beforeEach(async () => {
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_publication_audit"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_page_revisions"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_page_slugs"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_pages"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_profile_generations"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_profile_slugs"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_owner_profile_slots"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_profiles"),
    env.CALENDAR_DB.prepare("DELETE FROM provider_calendars"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_connections"),
    env.CALENDAR_DB.prepare(
      `INSERT INTO calendar_connections (
         id, workspace_id, principal_id, provider, mode, label, status,
         credential_ciphertext, token_expires_at, created_at, updated_at
       ) VALUES ('connection-route', ?, ?, 'google', 'oauth', 'route@example.com',
                 'connected', 'ciphertext', ?, ?, ?)`,
    ).bind(workspace, principal, "2026-08-16T20:00:00.000Z", now, now),
    env.CALENDAR_DB.prepare(
      `INSERT INTO provider_calendars (
         id, connection_id, provider_calendar_id, name, color, role, writable,
         freshness, is_primary, raw_json, created_at, updated_at
       ) VALUES ('calendar-route-primary', 'connection-route', 'route@example.com',
                 'Primary', '#6758e8', 'owner', 1, 'live', 1, '{}', ?, ?)`,
    ).bind(now, now),
  ]);
});

describe("organizer publication routes", () => {
  it("publishes and unpublishes a whole profile through the authenticated organizer boundary", async () => {
    const published = await worker.fetch(request(
      "/v1/publications/profiles",
      profilePublication(),
    ), env);
    expect(published.status).toBe(200);
    const receipt = await published.json<{
      publication: {
        generation: number;
        pages: readonly { sourceEventTypeId: string; canonicalUrl: string }[];
      };
    }>();
    expect(receipt.publication).toMatchObject({
      generation: 1,
      pages: [{
        sourceEventTypeId: "event-route-1",
        canonicalUrl: "https://cal.with-tap.ai/route-owner/30min",
      }],
    });

    const unpublished = await worker.fetch(request(
      "/v1/publications/profiles/unpublish",
      {
        schemaVersion: "tap.calendar.profile-unpublication.v1",
        sourceProfileId: "profile-route-1",
        expectedGeneration: 1,
      },
    ), env);
    expect(unpublished.status).toBe(200);
    expect(await unpublished.json()).toMatchObject({
      publication: { generation: 2, idempotentReplay: false },
    });
  });

  it("claims a public profile namespace without requiring an Event Type", async () => {
    const published = await worker.fetch(request(
      "/v1/publications/profiles",
      profilePublication(0, []),
    ), env);
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({
      publication: {
        sourceProfileId: "profile-route-1",
        profileSlug: "route-owner",
        generation: 1,
        idempotentReplay: false,
        pages: [],
      },
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_pages",
    ).first<number>("count")).toBe(0);
  });

  it("returns the current generation on a stale organizer write", async () => {
    await worker.fetch(request(
      "/v1/publications/profiles",
      profilePublication(),
    ), env);
    await worker.fetch(request(
      "/v1/publications/profiles",
      profilePublication(1, [publicationPage("Current title")]),
    ), env);
    const stale = await worker.fetch(request(
      "/v1/publications/profiles",
      profilePublication(1, [publicationPage("Stale title")]),
    ), env);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: "publication_conflict",
      message: "This Booking Profile changed in another TAP session. Refresh it and try again.",
      currentGeneration: 2,
    });
  });
});
