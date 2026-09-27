import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarGatewayWorker } from "../src/index";
import { hostBusyIntervals, reserveHosts } from "../src/collective-store";
import { authorizeWorkspacePrincipal } from "../src/organizer-auth";
import { hostScheduleAllowsInterval } from "../src/public-booking-read";

const workspace = "shared-workspace";
const start = "2026-09-21T14:00:00.000Z";
const end = "2026-09-21T14:30:00.000Z";
const schedule = {
  timeZone: "UTC", preferredStart: "09:00", preferredEnd: "17:00",
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minimumNoticeMinutes: 0, bookingHorizonDays: 60,
  windows: Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, start: "09:00", end: "17:00" })), overrides: [],
};
type ProviderEvent = Record<string, unknown> & { id: string; start: { dateTime: string }; end: { dateTime: string }; status?: string };
const events = new Map<string, Map<string, ProviderEvent>>();
let inserts = 0;
let uncertainPatch = false;
let failedHost: string | null = null;
const providerFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname === "challenges.cloudflare.com") {
    const body = await request.formData();
    return Response.json({ success: true, action: body.get("response") === "test-reschedule-token" ? "public_booking_reschedule" : "public_booking", hostname: "cal.with-tap.ai", challenge_ts: new Date().toISOString() });
  }
  if (url.hostname === "oauth2.googleapis.com") {
    const body = await request.formData();
    const principal = body.get("code") ?? body.get("refresh_token");
    return Response.json({ access_token: principal, refresh_token: principal, expires_in: 3600, token_type: "Bearer" });
  }
  const principal = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (url.pathname.endsWith("/users/me/calendarList")) return Response.json({ items: [{ id: `${principal}@example.com`, summary: principal, accessRole: "owner", primary: true }] });
  const inRange = (event: ProviderEvent, from: string, to: string) => event.status !== "cancelled" && Date.parse(event.start.dateTime) < Date.parse(to) && Date.parse(event.end.dateTime) > Date.parse(from);
  if (url.pathname.endsWith("/freeBusy")) {
    const body = await request.json<{ timeMin: string; timeMax: string; items: { id: string }[] }>();
    return Response.json({ timeMin: body.timeMin, timeMax: body.timeMax,
      calendars: Object.fromEntries(body.items.map(({ id }) => [id, id === failedHost ? { errors: [{ reason: "forbidden" }] } : {
        busy: [...(events.get(id)?.values() ?? [])].filter(event => inRange(event, body.timeMin, body.timeMax)).map(event => ({ start: event.start.dateTime, end: event.end.dateTime })),
      }])) });
  }
  const match = url.pathname.match(/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/u);
  if (match) {
    const calendar = decodeURIComponent(match[1]!);
    const id = match[2] ? decodeURIComponent(match[2]) : null;
    if (!events.has(calendar)) events.set(calendar, new Map());
    const calendarEvents = events.get(calendar)!;
    if (calendar === failedHost) return Response.json({ error: "forbidden" }, { status: 403 });
    if (request.method === "POST") {
      const body = await request.json<ProviderEvent>();
      const event = { ...body, status: body.status ?? "confirmed", etag: '"v1"', updated: new Date().toISOString(), htmlLink: "https://calendar.google.com/event?id=shared",
        ...(body.conferenceData ? { hangoutLink: "https://meet.google.com/shared-room", conferenceData: { conferenceSolution: { key: { type: "hangoutsMeet" } }, entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/shared-room" }] } } : {}) };
      calendarEvents.set(body.id, event); inserts++; return Response.json(event);
    }
    if (id && request.method === "DELETE") { calendarEvents.delete(id); return new Response(null, { status: 204 }); }
    if (id && request.method === "PATCH") {
      const current = calendarEvents.get(id);
      if (!current) return Response.json({}, { status: 404 });
      const event = { ...current, ...await request.json<Record<string, unknown>>(), etag: '"v2"' } as ProviderEvent;
      calendarEvents.set(id, event);
      if (uncertainPatch) { uncertainPatch = false; throw new Error("Provider response lost after write"); }
      return Response.json(event);
    }
    if (id) return calendarEvents.has(id) ? Response.json(calendarEvents.get(id)) : Response.json({}, { status: 404 });
    return Response.json({ items: [...calendarEvents.values()].filter(event => inRange(event, url.searchParams.get("timeMin")!, url.searchParams.get("timeMax")!)) });
  }
  throw new Error(`Unexpected provider request ${request.method} ${url}`);
};
const worker = createCalendarGatewayWorker(providerFetch);
const runtime = () => ({ ...env,
  TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1))),
  GOOGLE_CLIENT_ID: "google-client-id", GOOGLE_CLIENT_SECRET: "google-client-secret",
  PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  PUBLIC_BOOKING_SLOT_SIGNING_KEY: "shared-slot-test-key-at-least-32-bytes-long",
  PUBLIC_BOOKING_MANAGEMENT_SECRET: "shared-management-secret-at-least-32-bytes",
});
const call = (path: string, body?: unknown, principal?: string) => worker.fetch(new Request(`https://calendar-api.theaiplatform.app${path}`, {
  method: body === undefined ? "GET" : "POST", headers: { Origin: principal ? "http://localhost:3000" : "https://cal.with-tap.ai", "Content-Type": "application/json",
    ...(principal ? { "X-TAP-Workspace-Id": workspace, "X-TAP-Principal-Id": principal } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), runtime());
const connect = async (principal: string) => {
  events.set(`${principal}@example.com`, new Map());
  const started = await call("/v1/oauth/google/start", { id: `connection-${principal}`, label: principal }, principal);
  expect(started.status).toBe(201);
  const { authorizationUrl } = await started.json<{ authorizationUrl: string }>();
  const state = new URL(authorizationUrl).searchParams.get("state");
  expect((await call(`/v1/oauth/google/callback?state=${encodeURIComponent(state!)}&code=${principal}`, undefined, principal)).status).toBe(200);
  return (await env.CALENDAR_DB.prepare("SELECT id FROM provider_calendars WHERE connection_id = ?").bind(`connection-${principal}`).first<string>("id"))!;
};
const enroll = async (principal: string, calendar: string, hostSchedule = schedule) => {
  const response = await call("/v1/workspace-bookings/host", { expectedVersion: 0, enabled: true, displayName: principal, email: "spoofed@example.com", principalId: "spoofed",
    destinationCalendarId: calendar, conflictCalendarIds: [calendar], sourceAvailabilityScheduleId: "schedule-1", schedule: hostSchedule }, principal);
  expect(response.status).toBe(200);
  return response.json<{ enabled: boolean; host: { principalId: string; email: string } }>();
};
const profile = (expectedVersion = 0, organizer = "zack", hosts = ["zack", "vern"]) => ({ expectedVersion, profileSlug: "zephyr-test", displayName: "Zephyr", published: true,
  events: [{ id: "shared-meeting", slug: "meet-us", title: "Meet with us", description: "", durationMinutes: 30, organizerId: organizer, hostIds: hosts, location: "google-meet", approvalRequired: false }] });
const publish = async (input = profile(), principal = "zack") => {
  const response = await call("/v1/workspace-bookings/profile", input, principal);
  const body = await response.json<{ publication: { pages: { revisionId: string; canonicalUrl: string }[] } }>();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.publication.pages[0]!;
};
type Slot = { start: string; end: string; token: string };
const slots = async (revision: string, profileSlug = "zephyr-test", eventSlug = "meet-us") => {
  const response = await call(`/api/public/pages/${profileSlug}/${eventSlug}/availability?month=2026-09-01&timeZone=UTC&pageRevision=${revision}`);
  const body = await response.json<{ dates: { date: string; slots: Slot[] }[] }>();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body.dates.flatMap(date => date.slots);
};
const book = (slot: Slot, requestId = crypto.randomUUID()) => call("/api/public/pages/zephyr-test/meet-us/bookings", {
  schemaVersion: "tap.calendar.public-booking.v1", requestId, slotToken: slot.token, guest: { name: "Guest", email: "guest@example.com" }, turnstileToken: "test-turnstile-token",
});

const manage = (token: string, action: "reschedule" | "cancel", body: unknown) => worker.fetch(new Request(`https://calendar-api.theaiplatform.app/api/public/manage/${action}`, {
  method: "POST", headers: { Origin: "https://cal.with-tap.ai", "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
}), runtime());

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-09-20T12:00:00Z"); events.clear(); inserts = 0; failedHost = null; uncertainPatch = false;
  for (const table of ["calendar_activity_events", "calendar_host_reservations", "calendar_booking_hosts", "calendar_workspace_booking_profiles", "public_booking_workspace_audit", "public_booking_email_outbox", "public_booking_management_mutations", "public_booking_management_credentials", "public_booking_slot_proof_uses", "public_booking_attempts", "public_booking_owner_leases", "public_booking_publication_audit", "public_booking_page_revisions", "public_booking_page_slugs", "public_booking_pages", "public_booking_profile_generations", "public_booking_profile_slugs", "public_booking_owner_profile_slots", "public_booking_profiles", "provider_booking_resolutions", "provider_booking_commit_locks", "provider_booking_commits", "provider_calendars", "calendar_connections"]) await env.CALENDAR_DB.prepare(`DELETE FROM ${table}`).run();
});
afterEach(() => vi.useRealTimers());

describe("workspace collective bookings", () => {
  it("claims a workspace-owned profile that another admin can edit and exposes only public host names", async () => {
    const zack = await connect("zack"); const vern = await connect("vern");
    expect(await enroll("zack", zack)).toMatchObject({ host: { principalId: "zack", email: "zack@example.com" } }); await enroll("vern", vern);
    await publish(); const updated = await publish(profile(1), "second-admin");
    expect(updated.canonicalUrl).toBe("https://cal.with-tap.ai/zephyr-test/meet-us");
    const owner = await env.CALENDAR_DB.prepare("SELECT owner_kind, principal_id FROM public_booking_profiles").first();
    expect(owner).toEqual({ owner_kind: "workspace", principal_id: `workspace:${workspace}` });
    const response = await call("/api/public/pages/zephyr-test/meet-us");
    const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ profile: { displayName: "Zephyr" }, eventType: { hosts: [{ displayName: "zack" }, { displayName: "vern" }] } });
    expect(JSON.stringify(body)).not.toMatch(/@example|principalId|destinationCalendarId/);
    const settings = await (await call("/v1/workspace-bookings", undefined, "second-admin")).json<{ publication: { definition_version: number; hosts_current: boolean } }>();
    expect(settings.publication).toMatchObject({ definition_version: 2, hosts_current: true });
    const failing = profile(2); const failed = await call("/v1/workspace-bookings/profile", { ...failing, events: failing.events.map(event => ({ ...event, slug: "renamed-link" })) }, "second-admin");
    expect(failed.status).toBe(409);
    const draft = await (await call("/v1/workspace-bookings", undefined, "second-admin")).json<{ definition: { version: number }; publication: { definition_version: number } }>();
    expect(draft.definition.version).toBe(3); expect(draft.publication.definition_version).toBe(2);
    await publish(profile(3), "second-admin");
    expect((await call("/v1/workspace-bookings/profile", profile(0), "zack")).status).toBe(409);
    expect((await call("/v1/workspace-bookings/host", { expectedVersion: 0, enabled: true, displayName: "Imposter", destinationCalendarId: vern, conflictCalendarIds: [vern], sourceAvailabilityScheduleId: "s", schedule }, "imposter")).status).toBe(409);
  });

  it("attributes shared page changes to the authenticated manager, including unpublishing", async () => {
    const zack = await connect("zack"); const vern = await connect("vern");
    await enroll("zack", zack); await enroll("vern", vern);
    await publish();
    const changed = profile(1);
    await publish({ ...changed, events: changed.events.map(event => ({ ...event, title: "Updated shared meeting" })) }, "second-admin");
    expect((await call("/v1/workspace-bookings/profile", { ...profile(2), published: false }, "third-admin")).status).toBe(200);
    const result = await env.CALENDAR_DB.prepare("SELECT principal_id, status_id FROM calendar_activity_events WHERE workspace_id = ? AND activity_id = 'booking-page' ORDER BY status_id")
      .bind(workspace).all<{principal_id: string; status_id: string}>();
    expect(result.results).toEqual([
      { principal_id: "zack", status_id: "published" },
      { principal_id: "third-admin", status_id: "unpublished" },
      { principal_id: "second-admin", status_id: "updated" },
    ]);
  });

  it("intersects host schedules and busy calendars, fails closed on provider errors, and invalidates withdrawn hosts", async () => {
    const zack = await connect("zack"); const vern = await connect("vern");
    await enroll("zack", zack); await enroll("vern", vern, { ...schedule, timeZone: "America/New_York", windows: schedule.windows.map(window => ({ ...window, start: "09:10", end: "12:00" })) });
    events.get("vern@example.com")!.set("external", { id: "external", start: { dateTime: start }, end: { dateTime: end } });
    const { revisionId } = await publish();
    const available = await slots(revisionId); const monday = available.filter(slot => slot.start.startsWith("2026-09-21"));
    expect(monday.length).toBeGreaterThan(0);
    expect(monday.every(slot => slot.start >= "2026-09-21T13:10:00.000Z" && slot.end <= "2026-09-21T16:00:00.000Z")).toBe(true);
    expect(monday.some(slot => slot.start === start)).toBe(false);
    // Cohost's 09:10 window does not require the organizer's 30-minute grid to align with 09:10.
    expect(monday.some(slot => slot.start === "2026-09-21T13:30:00.000Z")).toBe(true);
    failedHost = "vern@example.com";
    expect((await call(`/api/public/pages/zephyr-test/meet-us/availability?month=2026-09-01&timeZone=UTC&pageRevision=${revisionId}`)).status).toBe(503);
    failedHost = null;
    expect((await call("/v1/workspace-bookings/host", { expectedVersion: 1, enabled: false }, "vern")).status).toBe(200);
    expect((await book(monday[0]!)).status).toBe(409);
    expect(inserts).toBe(0);
    // Unpublishing remains possible after a host withdraws consent.
    expect((await call("/v1/workspace-bookings/profile", { ...profile(1), published: false }, "zack")).status).toBe(200);
  });

  it("creates one invitation for both hosts and blocks the cohost's individual booking even before invitation delivery", async () => {
    const zack = await connect("zack"); const vern = await connect("vern");
    await enroll("zack", zack); await enroll("vern", vern); const { revisionId } = await publish();
    const slot = (await slots(revisionId)).find(value => value.start === start)!; expect(slot).toBeTruthy();
    const requestId = crypto.randomUUID(); const first = await book(slot, requestId);
    const result = await first.json(); expect(first.status, JSON.stringify(result)).toBe(201);
    expect((await book(slot, requestId)).status).toBe(201); expect(inserts).toBe(1);
    const invitation = [...events.get("zack@example.com")!.values()][0]!;
    expect(invitation.attendees).toEqual([{ email: "vern@example.com" }, { email: "guest@example.com" }]);
    // The mock intentionally has no invited copy in Vern's provider calendar yet.
    expect(events.get("vern@example.com")!.size).toBe(0);
    const conflict = await call("/v1/bookings/commit", { idempotencyKey: "vern-personal", destinationCalendarId: vern, conflictCalendarIds: [vern], start, end, title: "Other meeting", bookingKind: "meeting", attendeeEmails: [] }, "vern");
    expect(conflict.status, await conflict.text()).toBe(409); expect(inserts).toBe(1);
    expect(await hostBusyIntervals(env.CALENDAR_DB, { workspace, principal: "vern" }, start, end)).toHaveLength(1);
  });

  it("rechecks cohost conflicts after the guest selected a slot", async () => {
    await enroll("zack", await connect("zack")); await enroll("vern", await connect("vern")); const { revisionId } = await publish();
    const slot = (await slots(revisionId)).find(value => value.start === start)!;
    events.get("vern@example.com")!.set("late-conflict", { id: "late-conflict", start: { dateTime: start }, end: { dateTime: end } });
    const response = await book(slot); expect(response.status, await response.text()).toBe(409); expect(inserts).toBe(0);
  });

  it("keeps both old and new host reservations through an uncertain reschedule and releases them on cancellation", async () => {
    await enroll("zack", await connect("zack")); await enroll("vern", await connect("vern")); const { revisionId } = await publish();
    const available = await slots(revisionId);
    const original = available.find(value => value.start === start)!;
    const next = available.find(value => value.start === "2026-09-22T14:00:00.000Z")!;
    const created = await book(original);
    const result = await created.json<{ managementUrl: string }>(); expect(created.status).toBe(201);
    const token = new URL(result.managementUrl).hash.slice(1);
    const request = { schemaVersion: "tap.calendar.public-management-reschedule.v1", requestId: crypto.randomUUID(), expectedVersion: 1, slotToken: next.token, turnstileToken: "test-reschedule-token" };
    uncertainPatch = true;
    const uncertain = await manage(token, "reschedule", request); expect(uncertain.status, await uncertain.text()).toBe(503);
    const scope = { workspace, principal: "vern" };
    expect((await hostBusyIntervals(env.CALENDAR_DB, scope, original.start, original.end)).length).toBeGreaterThan(0);
    expect((await hostBusyIntervals(env.CALENDAR_DB, scope, next.start, next.end)).length).toBeGreaterThan(0);
    const recovered = await manage(token, "reschedule", request); expect(recovered.status, await recovered.text()).toBe(200);
    expect(await hostBusyIntervals(env.CALENDAR_DB, scope, original.start, original.end)).toEqual([]);
    expect((await hostBusyIntervals(env.CALENDAR_DB, scope, next.start, next.end)).length).toBeGreaterThan(0);
    const cancelled = await manage(token, "cancel", { schemaVersion: "tap.calendar.public-management-cancel.v1", requestId: crypto.randomUUID(), expectedVersion: 2 });
    expect(cancelled.status, await cancelled.text()).toBe(200);
    expect(await hostBusyIntervals(env.CALENDAR_DB, scope, next.start, next.end)).toEqual([]);
    expect(inserts).toBe(1);
    const calendar = await env.CALENDAR_DB.prepare("SELECT id FROM provider_calendars WHERE connection_id = 'connection-zack'").first<string>("id");
    const reused = await call("/v1/bookings/commit", { idempotencyKey: "reuse-after-cancel", destinationCalendarId: calendar, conflictCalendarIds: [calendar], start, end, title: "Now free", bookingKind: "meeting", attendeeEmails: [] }, "zack");
    expect(reused.status, await reused.text()).toBe(201);
  });

  it("requires every host to remain free before approving and preserves all attendees", async () => {
    const withNotice = { ...schedule, minimumNoticeMinutes: 1440 };
    await enroll("zack", await connect("zack"), withNotice); await enroll("vern", await connect("vern"), withNotice);
    const definition = profile();
    const { revisionId } = await publish({ ...definition, events: definition.events.map(event => ({ ...event, approvalRequired: true })) });
    const selected = (await slots(revisionId)).find(value => value.start === start)!;
    const response = await book(selected); const body = await response.json(); expect(response.status, JSON.stringify({ body, commits: (await env.CALENDAR_DB.prepare("SELECT state, last_error_code FROM provider_booking_commits").all()).results })).toBe(201);
    const pending = await (await call("/v1/workspace-bookings", undefined, "zack")).json<{ pendingApprovals: { operationId: string; guestEmail: string }[] }>();
    expect(pending.pendingApprovals).toHaveLength(1); expect(pending.pendingApprovals[0]!.guestEmail).toBe("guest@example.com");
    const unrelated = await (await call("/v1/workspace-bookings", undefined, "other-admin")).json<{ pendingApprovals: unknown[] }>();
    expect(unrelated.pendingApprovals).toEqual([]);
    const operation = pending.pendingApprovals[0]!.operationId;
    // Approval of an existing hold does not restart the booking minimum notice.
    vi.setSystemTime("2026-09-21T11:00:00Z");
    events.get("vern@example.com")!.set("new-busy", { id: "new-busy", start: { dateTime: start }, end: { dateTime: end } });
    const calendar = await env.CALENDAR_DB.prepare("SELECT id FROM provider_calendars WHERE connection_id = 'connection-zack'").first<string>("id");
    const approval = { idempotencyKey: "shared-approval", decision: "approve", attendeeEmails: ["guest@example.com"], conflictCalendarIds: [calendar], conferenceProvider: "google-meet" };
    const blocked = await call(`/v1/bookings/${operation}/resolve`, approval, "zack"); expect(blocked.status, await blocked.text()).toBe(409);
    events.get("vern@example.com")!.delete("new-busy");
    const approved = await call(`/v1/bookings/${operation}/resolve`, approval, "zack"); expect(approved.status, await approved.text()).toBe(200);
    expect([...events.get("zack@example.com")!.values()][0]!.attendees).toEqual(expect.arrayContaining([{ email: "vern@example.com" }, { email: "guest@example.com" }]));
  });

  it("atomically reserves overlapping host sets and releases declined/expired holds", async () => {
    const zack = await connect("zack"); const chris = await connect("chris");
    for (const [principal, calendar, operation] of [["zack", zack, "booking-ab"], ["chris", chris, "booking-bc"]]) {
      await env.CALENDAR_DB.prepare(`INSERT INTO provider_booking_commits (workspace_id, principal_id, idempotency_key, request_hash, destination_calendar_id, provider_event_id, booking_kind, start_at, end_at, state, created_at, updated_at)
        VALUES (?, ?, ?, 'hash', ?, ?, 'approval-hold', ?, ?, 'pending', ?, ?)`).bind(workspace, principal, operation, calendar, operation, start, end, start, start).run();
    }
    const host = (principalId: string) => ({ principalId, beforeMs: 0, afterMs: 15 * 60000 });
    const results = await Promise.all([
      reserveHosts(env.CALENDAR_DB, { workspace, principal: "zack" }, "booking-ab", start, end, [host("zack"), host("vern")]),
      reserveHosts(env.CALENDAR_DB, { workspace, principal: "chris" }, "booking-bc", start, end, [host("chris"), host("vern")]),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await env.CALENDAR_DB.prepare("SELECT COUNT(*) AS count FROM calendar_host_reservations").first("count")).toBe(2);
    const winner = results[0] ? "booking-ab" : "booking-bc";
    expect(await hostBusyIntervals(env.CALENDAR_DB, { workspace, principal: "vern" }, end, "2026-09-21T14:45:00Z")).toHaveLength(1);
    await env.CALENDAR_DB.prepare("UPDATE provider_booking_commits SET resolution_status = 'declined' WHERE idempotency_key = ?").bind(winner).run();
    expect(await hostBusyIntervals(env.CALENDAR_DB, { workspace, principal: "vern" }, start, end)).toEqual([]);
    await env.CALENDAR_DB.prepare("UPDATE provider_booking_commits SET resolution_status = NULL, hold_expired_at = ? WHERE idempotency_key = ?").bind(start, winner).run();
    expect(await hostBusyIntervals(env.CALENDAR_DB, { workspace, principal: "vern" }, start, end)).toEqual([]);
  });
});

describe("workspace authorization and schedule boundaries", () => {
  it("requires both canonical membership and an affirmative action decision", async () => {
    const result = { role: "admin" as string | null, actions: { "workspace:manage": true } };
    const binding = { checkWorkspaceAccessBySubject: async () => ({}), checkWorkspacePrincipalActions: vi.fn(async () => result) };
    expect(await authorizeWorkspacePrincipal({ AUTHZ_API: binding }, workspace, "canonical-admin", "workspace:manage")).toBe(true);
    expect(binding.checkWorkspacePrincipalActions).toHaveBeenCalledWith({ organizationId: workspace, userId: "canonical-admin", actions: ["workspace:manage"] });
    result.role = null;
    expect(await authorizeWorkspacePrincipal({ AUTHZ_API: binding }, workspace, "former-admin", "workspace:manage")).toBe(false);
    result.role = "member"; result.actions["workspace:manage"] = false;
    expect(await authorizeWorkspacePrincipal({ AUTHZ_API: binding }, workspace, "member", "workspace:manage")).toBe(false);
    await expect(authorizeWorkspacePrincipal({}, workspace, "admin", "workspace:manage")).rejects.toMatchObject({ status: 503 });
  });
  it("respects local dates, DST, notices, and date overrides for each host", () => {
    const host = { ...schedule, timeZone: "America/New_York", bookingHorizonDays: 100, windows: schedule.windows.map(window => ({ ...window, start: "09:00", end: "12:00" })) };
    const now = Date.parse("2026-10-20T00:00:00Z");
    expect(hostScheduleAllowsInterval(host, Date.parse("2026-11-02T13:30:00Z"), Date.parse("2026-11-02T14:00:00Z"), now)).toBe(false);
    expect(hostScheduleAllowsInterval(host, Date.parse("2026-11-02T14:00:00Z"), Date.parse("2026-11-02T14:30:00Z"), now)).toBe(true);
    expect(hostScheduleAllowsInterval({ ...host, overrides: [{ date: "2026-11-02", label: "Away", available: false, timeZone: host.timeZone }] }, Date.parse("2026-11-02T14:00:00Z"), Date.parse("2026-11-02T14:30:00Z"), now)).toBe(false);
    expect(hostScheduleAllowsInterval({ ...host, minimumNoticeMinutes: 120 }, Date.parse("2026-11-02T14:00:00Z"), Date.parse("2026-11-02T14:30:00Z"), Date.parse("2026-11-02T13:00:00Z"))).toBe(false);
  });
});
