import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { CalendarMcpScope } from "../../tap-calendar/src/mcp-contract";
import { CalendarMcpError, loadMcpConfiguration, type CalendarMcpProps, type McpOwner } from "./calendar-mcp-store";
import { loadPublicBookingAnalytics } from "./public-booking-analytics";

export interface LiveCalendar {
  readonly id: string; readonly name: string; readonly provider: string;
  readonly role: string; readonly writable: boolean; readonly status: string;
}
export interface LiveEvent {
  readonly id: string; readonly calendarId: string; readonly title: string;
  readonly start: string; readonly end: string; readonly kind: string; readonly status: string;
  readonly busy: boolean; readonly allDay: boolean;
  readonly attendees: readonly unknown[]; readonly location: string | null;
}
export interface LiveRange { readonly timeMin: string; readonly timeMax: string; readonly calendarIds: readonly string[] }
export interface CalendarLivePort {
  calendars(owner: McpOwner): Promise<readonly LiveCalendar[]>;
  events(owner: McpOwner, range: LiveRange): Promise<{
    readonly events: readonly LiveEvent[]; readonly syncedCalendarIds: readonly string[];
    readonly errors: readonly unknown[]; readonly truncated: boolean; readonly syncedAt: string;
  }>;
  create(owner: McpOwner, input: Record<string, unknown>, authorize: () => Promise<void>): Promise<Record<string, unknown>>;
  eventId(calendarId: string, providerEventId: string): string;
  providerEventId(event: LiveEvent): string | null;
}
const id = z.string().min(1).max(2048);
const instant = z.iso.datetime({ offset: true });
const rangeFields = { timeMin: instant, timeMax: instant, calendarIds: z.array(id).min(1).max(100) };
const typeFields = { profileId: id.optional(), eventTypeId: id.optional() };
const definitions = [
  { name: "list_calendars", scope: "calendar.read", description: "List the connected account's calendars, access roles, and write capabilities. Works while the Calendar UI is closed.", schema: z.strictObject({}) },
  { name: "list_events", scope: "calendar.read", description: "Read live event details for a bounded interval (at most 93 days). Includes Event Type identity when recorded by TAP. Returns a cursor; continue until nextOffset is null.", schema: z.strictObject({ ...rangeFields, ...typeFields, offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(50) }) },
  { name: "get_event", scope: "calendar.read", description: "Read one live event by its exact list_events ID and containing time range. Free/busy calendars and private work blocks remain redacted.", schema: z.strictObject({ ...rangeFields, eventId: id }) },
  { name: "find_available_slots", scope: "calendar.read", description: "Find free intervals from live calendars plus all configured Conflict Calendars. Checks conflicts only; these are not booking-page schedule/notice guarantees. Creation checks conflicts again.", schema: z.strictObject({ ...rangeFields, durationMinutes: z.number().int().min(5).max(480), limit: z.number().int().min(1).max(50).default(20) }) },
  { name: "create_event", scope: "calendar.write", description: "Create a real Google Calendar meeting or work block directly under the user's grant. Invites supplied attendees and can create a Meet/Zoom link. Use a new UUID idempotencyKey per intended event; retry the identical request with the SAME key after a timeout. Checks the destination and all configured/explicit Conflict Calendars. This creates an ad hoc event, not a booking-page Event Type booking.", schema: z.strictObject({
    idempotencyKey: z.uuid(), destinationCalendarId: id, conflictCalendarIds: z.array(id).max(100).default([]),
    title: z.string().trim().min(1).max(255), start: instant, end: instant,
    bookingKind: z.enum(["meeting", "work-block"]).default("meeting"), description: z.string().max(4000).optional(), location: z.string().max(1024).optional(),
    attendeeEmails: z.array(z.email().max(320)).max(100).default([]), conferenceProvider: z.enum(["none", "google-meet", "zoom"]).default("none"),
  }) },
  { name: "list_event_types", scope: "calendar.analytics", description: "List configured booking Event Types, including drafts, their descriptions, duration, and approval settings. Does not infer Event Types from event titles.", schema: z.strictObject(typeFields) },
  { name: "calendar_analytics", scope: "calendar.analytics", description: "Live aggregate calendar counts and scheduled minutes for a bounded interval, grouped by event kind, calendar, and recorded booking Event Type. Optional profileId/eventTypeId restricts to one type. Contains no event titles or attendee details. Counts are calendar entries, not deduplicated meetings, attendance, or productivity.", schema: z.strictObject({ ...rangeFields, ...typeFields }) },
  { name: "event_type_analytics", scope: "calendar.analytics", description: "Authoritative booking-page metrics for all Event Types or a single profileId + eventTypeId: recorded traffic, requests, currently confirmed bookings, lifetime confirmations, cancellations, pending/declined/expired requests, and attributed conversions. Includes coverage timestamps and draft types with zero activity. confirmed is current; lifetimeConfirmed includes later cancellations. Use calendar_analytics for date-filtered scheduled time.", schema: z.strictObject(typeFields) },
] as const;

type EventTypeIdentity = { readonly profileId: string; readonly eventTypeId: string };
const emptyFunnelMetrics = (): Awaited<ReturnType<typeof loadPublicBookingAnalytics>>["totals"] => ({
  views: 0, slotViews: 0, starts: 0, requests: 0, confirmed: 0,
  lifetimeConfirmed: 0, cancelled: 0, pending: 0, declined: 0, expired: 0,
  conversionViews: 0, convertedVisits: 0,
});
const key = (type: EventTypeIdentity) => JSON.stringify([type.profileId, type.eventTypeId]);
function typeFilter(input: { profileId?: string | undefined; eventTypeId?: string | undefined }) {
  if (Boolean(input.profileId) !== Boolean(input.eventTypeId)) throw new CalendarMcpError(400, "event_type_identity_required", "Provide both profileId and eventTypeId to select one Event Type.");
  return input.profileId && input.eventTypeId ? { profileId: input.profileId, eventTypeId: input.eventTypeId } : null;
}

export async function eventTypeAssignments(db: D1Database, owner: McpOwner, events: readonly LiveEvent[], port: CalendarLivePort) {
  // Provider identity, not the current title, ties renamed/rescheduled bookings
  // to their immutable booking-page revision. Scope both sides of the join.
  const identities = events.flatMap(event => {
    const providerId = port.providerEventId(event);
    return providerId ? [[event.calendarId, providerId]] : [];
  });
  const assignments = new Map<string, EventTypeIdentity>();
  // Join only events actually returned by this bounded provider query; a busy
  // account's entire historical booking ledger must not be loaded into memory.
  for (let offset = 0; offset < identities.length; offset += 200) {
    const rows = await db.prepare(`SELECT commits.destination_calendar_id, commits.provider_event_id,
      profiles.source_profile_id, pages.source_event_type_id
    FROM provider_booking_commits AS commits
    JOIN json_each(?) AS requested ON json_extract(requested.value, '$[0]') = commits.destination_calendar_id
      AND json_extract(requested.value, '$[1]') = commits.provider_event_id
    JOIN public_booking_attempts AS attempts ON attempts.provider_operation_id = commits.idempotency_key
      AND attempts.workspace_id = commits.workspace_id AND attempts.principal_id = commits.principal_id
    JOIN public_booking_page_revisions AS revisions ON revisions.id = attempts.revision_id
    JOIN public_booking_pages AS pages ON pages.id = revisions.page_id
    JOIN public_booking_profiles AS profiles ON profiles.id = pages.profile_id
    WHERE commits.workspace_id = ? AND commits.principal_id = ?
      AND profiles.workspace_id = ? AND profiles.principal_id = ?`)
    .bind(JSON.stringify(identities.slice(offset, offset + 200)), owner.workspace, owner.principal, owner.workspace, owner.principal)
    .all<{ destination_calendar_id: string; provider_event_id: string; source_profile_id: string; source_event_type_id: string }>();
    for (const row of rows.results) assignments.set(port.eventId(row.destination_calendar_id, row.provider_event_id), { profileId: row.source_profile_id, eventTypeId: row.source_event_type_id });
  }
  return assignments;
}

function validateRange(range: LiveRange) {
  const duration = Date.parse(range.timeMax) - Date.parse(range.timeMin);
  if (!(duration > 0) || duration > 93 * 86_400_000) throw new CalendarMcpError(400, "invalid_time_range", "Choose an increasing interval no longer than 93 days, with explicit time-zone offsets.");
}
function safeEvent(event: LiveEvent, calendars: readonly LiveCalendar[], types: ReadonlyMap<string, EventTypeIdentity>) {
  const redacted = calendars.find(calendar => calendar.id === event.calendarId)?.role === "free-busy" || event.kind === "work-block";
  return { ...event, ...(redacted ? { title: "Busy", attendees: [], location: null } : {}), eventType: redacted ? null : types.get(event.id) ?? null, detailsRedacted: redacted };
}

export function aggregateCalendarEvents(events: readonly LiveEvent[], range: LiveRange, types: ReadonlyMap<string, EventTypeIdentity>) {
  const empty = () => ({ eventCount: 0, timedEventCount: 0, allDayEventCount: 0, scheduledMinutes: 0, busyMinutes: 0 });
  const totals = empty();
  const byKind = new Map<string, ReturnType<typeof empty>>();
  const byCalendar = new Map<string, ReturnType<typeof empty>>();
  const byEventType = new Map<string, { eventType: EventTypeIdentity | null; metrics: ReturnType<typeof empty> }>();
  let excludedCancelledOrDeclined = 0;
  for (const event of events) {
    if (event.status === "cancelled" || event.status === "declined") { excludedCancelledOrDeclined++; continue; }
    const clipped = Math.max(0, Math.min(Date.parse(event.end), Date.parse(range.timeMax)) - Math.max(Date.parse(event.start), Date.parse(range.timeMin)));
    if (clipped === 0) continue;
    const type = types.get(event.id) ?? null;
    const typeKey = type ? key(type) : "unclassified";
    if (!byKind.has(event.kind)) byKind.set(event.kind, empty());
    if (!byCalendar.has(event.calendarId)) byCalendar.set(event.calendarId, empty());
    if (!byEventType.has(typeKey)) byEventType.set(typeKey, { eventType: type, metrics: empty() });
    for (const metrics of [totals, byKind.get(event.kind)!, byCalendar.get(event.calendarId)!, byEventType.get(typeKey)!.metrics]) {
      metrics.eventCount++;
      if (event.allDay) metrics.allDayEventCount++;
      else { metrics.timedEventCount++; metrics.scheduledMinutes += clipped / 60000; if (event.busy) metrics.busyMinutes += clipped / 60000; }
    }
  }
  return { totals, byKind: [...byKind].map(([kind, metrics]) => ({ kind, ...metrics })), byCalendar: [...byCalendar].map(([calendarId, metrics]) => ({ calendarId, ...metrics })), byEventType: [...byEventType.values()].map(({ eventType, metrics }) => ({ eventType, ...metrics })), excludedCancelledOrDeclined,
    measurement: "Calendar entries; overlapping entries and copies on separate calendars count separately. Minutes are clipped to the requested interval, summed per entry, and exclude all-day events. Unclassified means no recorded TAP booking Event Type. No attendance or productivity inference." };
}

export function createCalendarLiveTools(db: D1Database, props: CalendarMcpProps, port: CalendarLivePort, authorize: (scope: CalendarMcpScope) => Promise<void>) {
  const query = async (range: LiveRange) => {
    validateRange(range);
    const calendars = await port.calendars(props);
    if (range.calendarIds.some(id => !calendars.some(calendar => calendar.id === id))) throw new CalendarMcpError(404, "calendar_not_found", "A requested calendar is not accessible to this account.");
    const result = await port.events(props, range);
    if (result.truncated || result.errors.length || range.calendarIds.some(id => !result.syncedCalendarIds.includes(id))) {
      throw new CalendarMcpError(503, "calendar_data_incomplete", "Could not read every requested calendar completely. Reconnect an unavailable provider or use a smaller range; no partial totals or availability are reported.");
    }
    return { ...result, calendars, types: await eventTypeAssignments(db, props, result.events, port) };
  };
  return {
    definitions: definitions.filter(tool => props.scopes.includes(tool.scope) || (tool.name === "list_calendars" && props.scopes.includes("calendar.analytics"))),
    async call(name: string, raw: unknown): Promise<Record<string, unknown>> {
      const definition = definitions.find(tool => tool.name === name);
      if (!definition) throw new CalendarMcpError(404, "tool_not_found", "Unknown Calendar tool.");
      await authorize(name === "list_calendars" && !props.scopes.includes("calendar.read") && props.scopes.includes("calendar.analytics") ? "calendar.analytics" : definition.scope);
      // Validate before any provider call, including undeclared fields.
      const parsed = definition.schema.safeParse(raw);
      if (!parsed.success) throw new CalendarMcpError(400, "invalid_tool_input", parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
      switch (name) {
        case "list_calendars": return { calendars: await port.calendars(props) };
        case "create_event": {
          const input = definitions[4].schema.parse(raw);
          const configuration = await loadMcpConfiguration(db, props);
          const conflictCalendarIds = [...new Set([input.destinationCalendarId, ...configuration.conflictCalendarIds, ...input.conflictCalendarIds])].sort();
          validateRange({ timeMin: input.start, timeMax: input.end, calendarIds: conflictCalendarIds });
          if (conflictCalendarIds.length > 100) throw new CalendarMcpError(400, "too_many_calendars", "Choose at most 100 Conflict Calendars.");
          return port.create(props, { ...input, conflictCalendarIds }, () => authorize("calendar.write"));
        }
        case "list_event_types":
        case "event_type_analytics": {
          const filter = typeFilter(definitions[5].schema.parse(raw));
          const configuration = await loadMcpConfiguration(db, props);
          const snapshot = await loadPublicBookingAnalytics(db, props);
          const { pages } = snapshot;
          const identities = new Map(configuration.eventTypes.map(type => [key({ profileId: type.profileId, eventTypeId: type.id }), { profileId: type.profileId, eventTypeId: type.id, title: type.title, description: type.description, durationMinutes: type.durationMinutes, active: type.active, approvalRequired: type.approvalRequired }]));
          const rows = new Map(pages.map(page => [key({ profileId: page.sourceProfileId, eventTypeId: page.sourceEventTypeId }), page.analytics]));
          const keys = [...new Set([...identities.keys(), ...rows.keys()])].filter(value => !filter || value === key(filter));
          if (filter && !keys.length) throw new CalendarMcpError(404, "event_type_not_found", "This Event Type was not found in the connected account.");
          const eventTypes = keys.map(value => ({ ...(identities.get(value) ?? { profileId: JSON.parse(value)[0] as string, eventTypeId: JSON.parse(value)[1] as string, retired: true }), ...(name === "event_type_analytics" ? { analytics: rows.get(value) ?? emptyFunnelMetrics() } : {}) }));
          return { eventTypes, ...(name === "event_type_analytics" ? {
            period: "lifetime", generatedAt: snapshot.generatedAt,
            trafficSince: snapshot.trafficSince, conversionSince: snapshot.conversionSince,
            measurement: "Recorded booking-page history. confirmed is the current confirmed count; lifetimeConfirmed includes later cancellations. cancelled, pending, declined, and expired reflect current booking status. Traffic and attributed conversions begin at their coverage timestamps. Ad hoc events are not booking-page conversions. No attendance inference.",
            totals: keys.reduce((total, value) => {
              const metrics = rows.get(value);
              if (metrics) for (const metric of Object.keys(total) as (keyof typeof total)[]) total[metric] += metrics[metric];
              return total;
            }, emptyFunnelMetrics()),
          } : {}) };
        }
        case "find_available_slots": {
          const input = definitions[3].schema.parse(raw);
          const configuration = await loadMcpConfiguration(db, props);
          const range = { ...input, calendarIds: [...new Set([...input.calendarIds, ...configuration.conflictCalendarIds])] };
          if (range.calendarIds.length > 100) throw new CalendarMcpError(400, "too_many_calendars", "Choose at most 100 Conflict Calendars.");
          const result = await query(range);
          const busy = result.events.filter(event => event.busy && event.status !== "cancelled" && event.status !== "declined");
          const slots = [];
          for (let start = Math.max(Date.parse(input.timeMin), Math.ceil(Date.now() / 900000) * 900000); start + input.durationMinutes * 60000 <= Date.parse(input.timeMax) && slots.length < input.limit; start += 900000) {
            const end = start + input.durationMinutes * 60000;
            if (!busy.some(event => Date.parse(event.start) < end && Date.parse(event.end) > start)) slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
          }
          return { slots, checkedCalendarIds: range.calendarIds, syncedAt: result.syncedAt, policy: "Conflicts only; does not apply booking-page availability, buffers, or minimum notice. Creation rechecks conflicts." };
        }
        default: {
          const input = name === "get_event" ? definitions[2].schema.parse(raw) : name === "calendar_analytics" ? definitions[6].schema.parse(raw) : definitions[1].schema.parse(raw);
          const filter = "eventId" in input ? null : typeFilter(input);
          const result = await query(input);
          const events = result.events.filter(event => !filter || (result.types.has(event.id) && key(result.types.get(event.id)!) === key(filter)));
          if (name === "calendar_analytics") return { timeMin: input.timeMin, timeMax: input.timeMax, syncedAt: result.syncedAt, complete: true, filter, ...aggregateCalendarEvents(events, input, result.types) };
          if ("eventId" in input) {
            const event = events.find(event => event.id === input.eventId);
            if (!event) throw new CalendarMcpError(404, "event_not_found", "The event is not accessible in this interval.");
            return { event: safeEvent(event, result.calendars, result.types), syncedAt: result.syncedAt };
          }
          const paging = definitions[1].schema.parse(raw);
          return { events: events.slice(paging.offset, paging.offset + paging.limit).map(event => safeEvent(event, result.calendars, result.types)), total: events.length, nextOffset: paging.offset + paging.limit < events.length ? paging.offset + paging.limit : null, syncedAt: result.syncedAt, complete: true };
        }
      }
    },
  };
}

export function createCalendarLiveMcpServer(db: D1Database, props: CalendarMcpProps, port: CalendarLivePort, authorize: (scope: CalendarMcpScope) => Promise<void>) {
  const server = new McpServer({ name: "TAP Calendar", version: "0.3.0" });
  const tools = createCalendarLiveTools(db, props, port, authorize);
  for (const tool of tools.definitions) server.registerTool(tool.name, {
    description: tool.description, inputSchema: tool.schema,
    annotations: { readOnlyHint: tool.scope !== "calendar.write", destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input: unknown) => {
    try {
      const value = await tools.call(tool.name, input);
      return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
    } catch (error) {
      const known = error instanceof CalendarMcpError;
      return { isError: true, content: [{ type: "text" as const, text: known ? `${error.code}: ${error.message}` : "calendar_request_failed: Calendar could not complete this request. For a creation timeout, retry the identical request with the same idempotencyKey." }] };
    }
  });
  return server;
}
