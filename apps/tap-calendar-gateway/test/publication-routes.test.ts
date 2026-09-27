import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createCalendarGatewayWorker } from "../src/index";
import type { PublishedBookingLink } from "../src/booking-links";
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

const linksRequest = (query = "", user = principal, workspaceId = workspace) => new Request(
  `https://calendar-api.theaiplatform.app/v1/booking-links${query}`,
  { headers: { "X-TAP-Principal-Id": user, "X-TAP-Workspace-Id": workspaceId } },
);
const selectionQuery = (link: PublishedBookingLink) => `?${new URLSearchParams({
  profileId: link.profileId, eventTypeId: link.eventTypeId,
  revisionId: link.revisionId, generation: String(link.generation),
})}`;
const listLinks = async () => {
  const response = await worker.fetch(linksRequest(), env);
  expect(response.status).toBe(200);
  return response.json<{ links: PublishedBookingLink[] }>();
};

describe("host-mediated published booking links", () => {
  it("reads committed public metadata without a Calendar panel or provider requests", async () => {
    expect(await listLinks()).toMatchObject({ links: [] });
    const published = await worker.fetch(request("/v1/publications/profiles", profilePublication()), env);
    const receipt = await published.json<{ publication: { pages: { canonicalUrl: string; revisionId: string }[] } }>();
    const response = await worker.fetch(linksRequest(), { ...env, PUBLIC_BOOKING_BASE_URL: "https://new-host.example" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      schemaVersion: "tap.calendar.booking-links.v1", userId: principal, workspaceId: workspace,
      links: [{ profileId: "profile-route-1", eventTypeId: "event-route-1", title: "30 minute meeting",
        durationMinutes: 30, url: receipt.publication.pages[0]!.canonicalUrl,
        revisionId: receipt.publication.pages[0]!.revisionId, generation: 1 }],
    });
    // Querying and resolving do not create bookings, provider events, or audit writes.
    const link = (await listLinks()).links[0]!;
    expect((await worker.fetch(linksRequest(selectionQuery(link)), env)).status).toBe(200);
    expect(await env.CALENDAR_DB.prepare("SELECT COUNT(*) AS n FROM public_booking_publication_audit").first("n")).toBe(1);
    expect(await env.CALENDAR_DB.prepare("SELECT COUNT(*) AS n FROM provider_booking_commits").first("n")).toBe(0);
  });

  it("isolates both user and workspace", async () => {
    await worker.fetch(request("/v1/publications/profiles", profilePublication()), env);
    for (const [otherUser, otherWorkspace] of [["another-user", workspace], [principal, "another-workspace"]]) {
      const response = await worker.fetch(linksRequest("", otherUser, otherWorkspace), env);
      expect(await response.json()).toMatchObject({ userId: otherUser, workspaceId: otherWorkspace, links: [] });
      const selection = (await listLinks()).links[0]!;
      expect((await worker.fetch(linksRequest(selectionQuery(selection), otherUser, otherWorkspace), env)).status).toBe(409);
    }
    // A client cannot override authenticated ownership through query parameters.
    expect((await worker.fetch(linksRequest("?principalId=another-user"), env)).status).toBe(400);
    expect((await worker.fetch(linksRequest(), { ...env, LOCAL_DEVELOPMENT: "false" })).status).toBe(401);
  });

  it("keeps the acknowledged canonical URL on an idempotent publication replay", async () => {
    await worker.fetch(request("/v1/publications/profiles", profilePublication()), env);
    const replay = await worker.fetch(request("/v1/publications/profiles", profilePublication()),
      { ...env, PUBLIC_BOOKING_BASE_URL: "https://new-host.example" });
    expect(await replay.json()).toMatchObject({ publication: { idempotentReplay: true, pages: [
      { canonicalUrl: "https://cal.with-tap.ai/route-owner/30min" },
    ] } });
    expect((await listLinks()).links[0]?.url).toBe("https://cal.with-tap.ai/route-owner/30min");
  });

  it("rejects stale selections across update, pause, unpublish and republish", async () => {
    await worker.fetch(request("/v1/publications/profiles", profilePublication()), env);
    const first = (await listLinks()).links[0]!;
    await worker.fetch(request("/v1/publications/profiles", profilePublication(1, [publicationPage("New title")])), env);
    expect((await listLinks()).links[0]?.title).toBe("New title");
    expect((await worker.fetch(linksRequest(selectionQuery(first)), env)).status).toBe(409);
    const updated = (await listLinks()).links[0]!;
    // Calendar publishes only active Event Types; pausing omits the page.
    await worker.fetch(request("/v1/publications/profiles", profilePublication(2, [])), env);
    expect((await listLinks()).links).toEqual([]);
    expect((await worker.fetch(linksRequest(selectionQuery(updated)), env)).status).toBe(409);
    await worker.fetch(request("/v1/publications/profiles", profilePublication(3)), env);
    const republished = (await listLinks()).links[0]!;
    expect(republished.revisionId).toBe(first.revisionId);
    expect((await worker.fetch(linksRequest(selectionQuery(first)), env)).status).toBe(409);
    await worker.fetch(request("/v1/publications/profiles/unpublish", {
      schemaVersion: "tap.calendar.profile-unpublication.v1", sourceProfileId: "profile-route-1", expectedGeneration: 4,
    }), env);
    expect((await listLinks()).links).toEqual([]);
    expect((await worker.fetch(linksRequest(selectionQuery(republished)), env)).status).toBe(409);
  });

  it("does not expose failed or unconfirmed publication changes", async () => {
    const failed = { ...publicationPage("Unconfirmed title"), destinationCalendarId: "missing-calendar" };
    expect((await worker.fetch(request("/v1/publications/profiles", profilePublication(0, [failed])), env)).status).toBe(403);
    expect((await listLinks()).links).toEqual([]);
    await worker.fetch(request("/v1/publications/profiles", profilePublication()), env);
    const live = (await listLinks()).links;
    await worker.fetch(request("/v1/publications/profiles", profilePublication(1, [failed])), env);
    expect((await listLinks()).links).toEqual(live);
    expect((await worker.fetch(request("/v1/publications/profiles", profilePublication(0, [publicationPage("Stale title")])), env)).status).toBe(409);
    expect((await listLinks()).links).toEqual(live);
  });

  it.each(["draft", "paused", "unpublished"])("excludes %s pages", async status => {
    await worker.fetch(request("/v1/publications/profiles", profilePublication()), env);
    await env.CALENDAR_DB.prepare("UPDATE public_booking_pages SET status = ?").bind(status).run();
    expect((await listLinks()).links).toEqual([]);
  });

  it.each([
    "UPDATE public_booking_profiles SET status = 'draft'",
    "UPDATE public_booking_profiles SET owner_kind = 'workspace'",
    "UPDATE public_booking_profile_slugs SET active = 0",
    "UPDATE public_booking_page_slugs SET active = 0",
    "UPDATE public_booking_pages SET current_revision_id = NULL",
  ])("excludes unroutable or non-personal publications: %s", async sql => {
    await worker.fetch(request("/v1/publications/profiles", profilePublication()), env);
    await env.CALENDAR_DB.prepare(sql).run();
    expect((await listLinks()).links).toEqual([]);
  });

  it("requires a new confirmed publication for legacy pages with no stored URL", async () => {
    await worker.fetch(request("/v1/publications/profiles", profilePublication()), env);
    await env.CALENDAR_DB.prepare("UPDATE public_booking_pages SET canonical_url = NULL").run();
    expect((await listLinks()).links).toEqual([]);
    await worker.fetch(request("/v1/publications/profiles", profilePublication(1)), env);
    expect((await listLinks()).links[0]?.url).toBe("https://cal.with-tap.ai/route-owner/30min");
  });
});

beforeEach(async () => {
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare("DELETE FROM calendar_activity_events"),
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

  it("records actual page publication changes, excluding no-op saves and stale writes", async () => {
    const send = (body: unknown) => worker.fetch(request("/v1/publications/profiles", body), env);
    const initial = await send(profilePublication());
    expect(initial.status).toBe(200);
    const first = await initial.json<{ publication: { generation: number } }>();
    const replay = await send(profilePublication(first.publication.generation));
    expect(replay.status).toBe(200);
    const second = await replay.json<{ publication: { generation: number } }>();
    const updated = await send(profilePublication(second.publication.generation, [publicationPage("Changed meeting")]));
    expect(updated.status).toBe(200);
    const third = await updated.json<{ publication: { generation: number } }>();
    expect((await send(profilePublication(0, [publicationPage("Stale change")]))).status).toBe(409);
    expect((await worker.fetch(request("/v1/publications/profiles/unpublish", {
      schemaVersion: "tap.calendar.profile-unpublication.v1", sourceProfileId: "profile-route-1", expectedGeneration: third.publication.generation,
    }), env)).status).toBe(200);
    const activity = await env.CALENDAR_DB.prepare("SELECT status_id FROM calendar_activity_events WHERE workspace_id = ? AND principal_id = ? AND activity_id = 'booking-page' ORDER BY event_key")
      .bind(workspace, principal).all<{status_id: string}>();
    expect(activity.results.map(row => row.status_id)).toEqual(["published", "updated", "unpublished"]);
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
