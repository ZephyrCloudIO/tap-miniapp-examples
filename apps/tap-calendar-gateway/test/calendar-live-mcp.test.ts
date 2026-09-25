import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateCalendarEvents, createCalendarLiveTools, type CalendarLivePort, type LiveEvent } from "../src/calendar-live-mcp";
import { loadMcpConfiguration, requireMcpGrant, revokeMcpGrant, saveMcpConfiguration, type CalendarMcpProps } from "../src/calendar-mcp-store";

const owner = { workspace: "mcp-workspace", principal: "mcp-user" };
const props: CalendarMcpProps = { ...owner, grantId: "mcp-grant", scopes: ["calendar.read", "calendar.analytics", "calendar.write"] };
const range = { timeMin: "2026-10-01T10:00:00Z", timeMax: "2026-10-01T12:00:00Z", calendarIds: ["mcp-calendar"] };
const event = (overrides: Partial<LiveEvent> = {}): LiveEvent => ({ id: "event-1", calendarId: "mcp-calendar", title: "Customer call", start: "2026-10-01T09:30:00Z", end: "2026-10-01T11:00:00Z", kind: "meeting", status: "confirmed", busy: true, allDay: false, attendees: [{ email: "guest@example.com" }], location: "zoom", ...overrides });
const configuration = { conflictCalendarIds: ["mcp-conflict"], eventTypes: [{ profileId: "profile-1", id: "consultation", title: "Consultation", description: "Introductory meeting", durationMinutes: 30, active: true, approvalRequired: false }] };
const port = (events: readonly LiveEvent[] = []): CalendarLivePort => ({
  calendars: vi.fn(async () => [{ id: "mcp-calendar", name: "Primary", provider: "google", role: "owner", writable: true, status: "connected" }, { id: "mcp-conflict", name: "Conflicts", provider: "google", role: "reader", writable: false, status: "connected" }]),
  events: vi.fn(async (_owner, range) => ({ events, syncedCalendarIds: range.calendarIds, errors: [], truncated: false, syncedAt: "2026-10-01T09:00:00Z" })),
  create: vi.fn(async (_owner, args, authorize) => { await authorize(); return { created: true, ...args }; }),
  eventId: (calendar, event) => `${calendar}:${event}`,
  providerEventId: event => event.id,
});
const authorize = (value = props) => async (scope: typeof props.scopes[number]) => { await requireMcpGrant(env.CALENDAR_DB, value, scope); };
beforeEach(async () => {
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare("DELETE FROM calendar_mcp_authorizations"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_mcp_grants"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_mcp_configuration"),
  ]);
  await env.CALENDAR_DB.prepare("INSERT INTO calendar_mcp_grants (id, workspace_id, principal_id, client_name, scopes_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(props.grantId, props.workspace, props.principal, "Chloe", JSON.stringify(props.scopes), new Date().toISOString()).run();
  await saveMcpConfiguration(env.CALENDAR_DB, owner, { sourceRevision: 2, configuration });
});

describe("live Calendar specialist tools", () => {
  it("keeps configuration owner-scoped and rejects older snapshots", async () => {
    await saveMcpConfiguration(env.CALENDAR_DB, owner, { sourceRevision: 1, configuration: { conflictCalendarIds: [], eventTypes: [] } });
    expect(await loadMcpConfiguration(env.CALENDAR_DB, owner)).toEqual(configuration);
    await expect(loadMcpConfiguration(env.CALENDAR_DB, { ...owner, principal: "someone-else" })).rejects.toMatchObject({ code: "calendar_setup_required" });
    await expect(saveMcpConfiguration(env.CALENDAR_DB, owner, { sourceRevision: 3, configuration: { ...configuration, credentials: "do not accept" } })).rejects.toMatchObject({ code: "invalid_mcp_configuration" });
  });
  it("enforces grant scope, identity, and revocation on every call", async () => {
    const provider = port();
    const readOnly = { ...props, scopes: ["calendar.read"] as const };
    const tools = createCalendarLiveTools(env.CALENDAR_DB, readOnly, provider, authorize(readOnly));
    expect(tools.definitions.map(tool => tool.name)).not.toContain("create_event");
    await expect(tools.call("create_event", {})).rejects.toMatchObject({ code: "calendar_scope_required" });
    await expect(requireMcpGrant(env.CALENDAR_DB, { ...props, principal: "intruder" }, "calendar.read")).rejects.toMatchObject({ code: "calendar_grant_revoked" });
    await revokeMcpGrant(env.CALENDAR_DB, { ...owner, principal: "intruder" }, props.grantId);
    await expect(tools.call("list_calendars", {})).resolves.toHaveProperty("calendars");
    await revokeMcpGrant(env.CALENDAR_DB, owner, props.grantId);
    await expect(tools.call("list_calendars", {})).rejects.toMatchObject({ code: "calendar_grant_revoked" });
    expect(provider.create).not.toHaveBeenCalled();
  });
  it("returns individual details, paginates without silently truncating, and redacts private Work Blocks", async () => {
    const provider = port([event(), event({ id: "private", kind: "work-block", title: "Private project" })]);
    const tools = createCalendarLiveTools(env.CALENDAR_DB, props, provider, authorize());
    const first = await tools.call("list_events", { ...range, limit: 1 });
    expect(first).toMatchObject({ total: 2, nextOffset: 1, events: [{ title: "Customer call", attendees: [{ email: "guest@example.com" }] }] });
    expect(await tools.call("get_event", { ...range, eventId: "private" })).toMatchObject({ event: { title: "Busy", attendees: [], location: null, detailsRedacted: true } });
    await expect(tools.call("get_event", { ...range, eventId: "foreign" })).rejects.toMatchObject({ code: "event_not_found" });
  });
  it("refuses partial analytics and checks calendar ownership before provider access", async () => {
    const provider = port([event()]);
    const tools = createCalendarLiveTools(env.CALENDAR_DB, props, provider, authorize());
    await expect(tools.call("calendar_analytics", { ...range, calendarIds: ["foreign-calendar"] })).rejects.toMatchObject({ code: "calendar_not_found" });
    expect(provider.events).not.toHaveBeenCalled();
    provider.events = vi.fn(async () => ({ events: [event()], syncedCalendarIds: range.calendarIds, errors: [], truncated: true, syncedAt: "now" }));
    await expect(tools.call("calendar_analytics", range)).rejects.toMatchObject({ code: "calendar_data_incomplete" });
    provider.events = vi.fn(async () => ({ events: [], syncedCalendarIds: [], errors: ["provider down"], truncated: false, syncedAt: "now" }));
    await expect(tools.call("find_available_slots", { ...range, durationMinutes: 30 })).rejects.toMatchObject({ code: "calendar_data_incomplete" });
  });
  it("clips minutes to the window and separates all-day, declined, kind, and Event Type counts", () => {
    const result = aggregateCalendarEvents([event(), event({ id: "block", kind: "work-block", start: "2026-10-01T11:30:00Z", end: "2026-10-01T12:30:00Z" }), event({ id: "all-day", allDay: true, start: "2026-10-01T00:00:00Z", end: "2026-10-02T00:00:00Z" }), event({ id: "declined", status: "declined" })], range, new Map([["event-1", { profileId: "profile-1", eventTypeId: "consultation" }]]));
    expect(result.totals).toEqual({ eventCount: 3, timedEventCount: 2, allDayEventCount: 1, scheduledMinutes: 90, busyMinutes: 90 });
    expect(result.excludedCancelledOrDeclined).toBe(1);
    expect(result.byEventType).toContainEqual(expect.objectContaining({ eventType: { profileId: "profile-1", eventTypeId: "consultation" }, scheduledMinutes: 60 }));
    expect(JSON.stringify(result)).not.toMatch(/Customer call|guest@example.com/);
  });
  it("serves all configured Event Types and one selected type with explicit lifetime zero totals", async () => {
    const tools = createCalendarLiveTools(env.CALENDAR_DB, props, port(), authorize());
    expect(await tools.call("event_type_analytics", { profileId: "profile-1", eventTypeId: "consultation" })).toMatchObject({ period: "lifetime", totals: { views: 0, requests: 0, confirmed: 0 }, eventTypes: [{ title: "Consultation", durationMinutes: 30 }] });
    await expect(tools.call("list_event_types", { eventTypeId: "consultation" })).rejects.toMatchObject({ code: "event_type_identity_required" });
    await expect(tools.call("event_type_analytics", { profileId: "profile-1", eventTypeId: "missing" })).rejects.toMatchObject({ code: "event_type_not_found" });
  });
  it("adds every configured Conflict Calendar and passes through stable retry identity", async () => {
    const provider = port();
    const tools = createCalendarLiveTools(env.CALENDAR_DB, props, provider, authorize());
    const input = { title: "New meeting", start: range.timeMin, end: range.timeMax, idempotencyKey: crypto.randomUUID(), destinationCalendarId: "mcp-calendar" };
    expect(await tools.call("create_event", input)).toMatchObject({ created: true, conflictCalendarIds: ["mcp-calendar", "mcp-conflict"], idempotencyKey: input.idempotencyKey });
    expect(provider.create).toHaveBeenCalledWith(expect.objectContaining(owner), expect.objectContaining({ idempotencyKey: input.idempotencyKey }), expect.any(Function));
  });
  it("rechecks authorization at the provider write boundary", async () => {
    const provider = port();
    let inserted = false;
    provider.create = async (_owner, _input, check) => { await revokeMcpGrant(env.CALENDAR_DB, owner, props.grantId); await check(); inserted = true; return {}; };
    const tools = createCalendarLiveTools(env.CALENDAR_DB, props, provider, authorize());
    await expect(tools.call("create_event", { title: "New meeting", start: range.timeMin, end: range.timeMax, idempotencyKey: crypto.randomUUID(), destinationCalendarId: "mcp-calendar" })).rejects.toMatchObject({ code: "calendar_grant_revoked" });
    expect(inserted).toBe(false);
  });
});
