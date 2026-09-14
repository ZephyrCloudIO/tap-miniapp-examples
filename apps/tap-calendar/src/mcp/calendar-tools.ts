import { defineMcpServer } from "@theaiplatform/miniapp-sdk/mcp";
import {
  sdk,
  type MiniAppJsonValue,
  type MiniAppMaybePromise,
  type MiniAppMcpExecutionContext,
  type MiniAppStorageAddress,
  type MiniAppStorageEntry,
} from "@theaiplatform/miniapp-sdk/sdk";
import { availabilityForDate } from "../availability-policy";
import { calculateDailyTimeAllocation } from "../daily-time-allocation";
import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarState,
  ConnectedCalendar,
  MeetingLocation,
} from "../domain";
import type {
  CalendarEventCacheEntry,
  CalendarEventCacheSnapshot,
} from "../event-cache";
import { calendarPrincipalStorageAddresses } from "../principal-storage";
import { ianaZonedInstant, resolveIanaWallTime } from "./iana-wall-time";
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MAX_STORED_BYTES = 1_000_000;
const MAX_EVENTS = 200;
const MAX_SLOTS = 96;
const MAX_DRAFT_CONFLICTS = 20;
const MAX_CACHE_ENTRIES = 10;
const MAX_CACHE_EVENTS = 4_000;
const FRESH_CACHE_AGE_MS = 5 * 60_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 60_000;
const LIVE_CONFIRMATION_POLICY =
  "Candidate times and meeting drafts must be revalidated against the live calendar gateway immediately before booking.";

const meetingProviders = new Set<MeetingLocation>([
  "tap-room",
  "tap-huddle",
  "google-meet",
  "microsoft-teams",
  "zoom",
  "webex",
  "goto",
  "phone",
  "physical",
  "custom",
]);

const isCalendarState = (value: unknown): value is CalendarState => {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    Array.isArray(value.accounts) &&
    Array.isArray(value.events) &&
    Array.isArray(value.availability) &&
    Array.isArray(value.bookingProfiles) &&
    Array.isArray(value.notificationChannels)
  );
};

const allCalendars = (state: CalendarState): readonly ConnectedCalendar[] =>
  state.accounts.flatMap(account => account.calendars);

const minutesFromMidnight = (value: string): number => {
  const parts = value.split(":");
  return Number(parts[0] ?? 0) * 60 + Number(parts[1] ?? 0);
};

const intervalsOverlap = (
  start: number,
  end: number,
  candidateStart: number,
  candidateEnd: number,
): boolean => start < candidateEnd && end > candidateStart;

const calculateAvailableSlots = (input: {
  readonly date: string;
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly intervalMinutes: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly busy: readonly Pick<CalendarEvent, "start" | "end">[];
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
}) => {
  const slots: { start: string; end: string }[] = [];
  const startMinute = minutesFromMidnight(input.windowStart);
  const endMinute = minutesFromMidnight(input.windowEnd);
  const windowEnd = resolveIanaWallTime({
    date: input.date,
    time: input.windowEnd,
    timeZone: input.timeZone,
    disambiguation: "earlier",
  });
  if (!windowEnd.ok) return slots;
  for (
    let minute = startMinute;
    minute + input.durationMinutes <= endMinute;
    minute += input.intervalMinutes
  ) {
    const startTime = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const startResolution = resolveIanaWallTime({
      date: input.date,
      time: startTime,
      timeZone: input.timeZone,
      disambiguation: "earlier",
    });
    if (!startResolution.ok) continue;
    const start = startResolution.instant;
    const end = new Date(start.getTime() + input.durationMinutes * 60_000);
    if (end.getTime() > windowEnd.instant.getTime()) continue;
    const blocked = input.busy.some(event =>
      intervalsOverlap(
        start.getTime() - input.bufferBeforeMinutes * 60_000,
        end.getTime() + input.bufferAfterMinutes * 60_000,
        new Date(event.start).getTime(),
        new Date(event.end).getTime(),
      ),
    );
    if (!blocked) slots.push({ start: start.toISOString(), end: end.toISOString() });
  }
  return slots;
};

const nextCalendarDate = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);

const resolveAvailabilityRange = (
  date: string,
  start: string,
  end: string,
  timeZone: string,
): { readonly start: string; readonly end: string } | null => {
  const startResolution = resolveIanaWallTime({ date, time: start, timeZone, disambiguation: "earlier" });
  const endResolution = resolveIanaWallTime({ date, time: end, timeZone, disambiguation: "earlier" });
  if (!startResolution.ok || !endResolution.ok) return null;
  return {
    start: startResolution.instant.toISOString(),
    end: endResolution.instant.toISOString(),
  };
};

const resolveAvailabilityDay = (
  date: string,
  timeZone: string,
): { readonly start: string; readonly end: string } | null => {
  const startResolution = resolveIanaWallTime({ date, time: "00:00", timeZone, disambiguation: "earlier" });
  const endResolution = resolveIanaWallTime({
    date: nextCalendarDate(date),
    time: "00:00",
    timeZone,
    disambiguation: "earlier",
  });
  if (!startResolution.ok || !endResolution.ok) return null;
  return {
    start: startResolution.instant.toISOString(),
    end: endResolution.instant.toISOString(),
  };
};

const resolveDailySummaryDay = (
  date: string,
  timeZone: string,
): { readonly start: string; readonly end: string } | null => {
  // Temporal-compatible boundaries choose the first valid instant after a
  // midnight gap and the earlier instant in a midnight fold.
  const startResolution = resolveIanaWallTime({
    date,
    time: "00:00",
    timeZone,
    disambiguation: "compatible",
  });
  const endResolution = resolveIanaWallTime({
    date: nextCalendarDate(date),
    time: "00:00",
    timeZone,
    disambiguation: "compatible",
  });
  if (
    !startResolution.ok ||
    !endResolution.ok ||
    endResolution.instant.getTime() <= startResolution.instant.getTime()
  ) {
    return null;
  }
  return {
    start: startResolution.instant.toISOString(),
    end: endResolution.instant.toISOString(),
  };
};

const guestCompatibilityError = (
  meetingProvider: MeetingLocation,
  attendees: readonly CalendarAttendee[],
): string | null =>
  (meetingProvider === "tap-room" || meetingProvider === "tap-huddle") &&
  attendees.some(attendee => attendee.kind === "external")
    ? "External guests are not TAP users. Confirm accountless guest access before using a TAP meeting room or scheduled TAP Voice Huddle."
    : null;

export type CalendarMcpExecutionContext = MiniAppMcpExecutionContext;

export interface CalendarMcpRuntime {
  getExecutionContext(): MiniAppMaybePromise<CalendarMcpExecutionContext>;
  readStorage(
    address: MiniAppStorageAddress,
  ): MiniAppMaybePromise<MiniAppStorageEntry>;
  /** Injectable for deterministic freshness tests. */
  now?(): number;
}

const defaultRuntime: CalendarMcpRuntime = {
  getExecutionContext: () => {
    if (!sdk.mcp) {
      return calendarMcpError(
        "the host did not provide package-runtime MCP execution context.",
      );
    }
    return sdk.mcp.getExecutionContext();
  },
  readStorage: address => sdk.storage.get(address),
};

function calendarMcpError(message: string): never {
  throw new Error(`TAP Calendar MCP is unavailable: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isCachedCalendarEvent = (value: unknown): value is CalendarEvent =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.calendarId === "string" &&
  typeof value.title === "string" &&
  isIsoTimestamp(value.start) &&
  isIsoTimestamp(value.end) &&
  Date.parse(value.end) > Date.parse(value.start) &&
  (value.kind === "meeting" || value.kind === "work-block" ||
    value.kind === "hold" || value.kind === "focus") &&
  (value.status === "pending" || value.status === "confirmed" ||
    value.status === "declined" || value.status === "cancelled") &&
  Array.isArray(value.attendees) &&
  (value.busy === undefined || typeof value.busy === "boolean") &&
  (value.allDay === undefined || typeof value.allDay === "boolean");

const isCalendarEventCacheEntry = (
  value: unknown,
): value is CalendarEventCacheEntry =>
  isRecord(value) &&
  typeof value.key === "string" &&
  value.key.length <= 4_096 &&
  isIsoTimestamp(value.timeMin) &&
  isIsoTimestamp(value.timeMax) &&
  Date.parse(value.timeMax) > Date.parse(value.timeMin) &&
  Array.isArray(value.calendarIds) &&
  value.calendarIds.length <= 100 &&
  value.calendarIds.every(calendarId => typeof calendarId === "string") &&
  Array.isArray(value.events) &&
  value.events.every(isCachedCalendarEvent) &&
  isRecord(value.calendarSyncedAt) &&
  Object.values(value.calendarSyncedAt).every(isIsoTimestamp) &&
  isIsoTimestamp(value.updatedAt) &&
  (value.lastFullSyncAt === null || isIsoTimestamp(value.lastFullSyncAt)) &&
  isIsoTimestamp(value.lastAccessedAt) &&
  typeof value.partial === "boolean";

const isCalendarEventCacheSnapshot = (
  value: unknown,
): value is CalendarEventCacheSnapshot =>
  isRecord(value) &&
  value.schemaVersion === 1 &&
  Array.isArray(value.entries) &&
  value.entries.length <= MAX_CACHE_ENTRIES &&
  value.entries.every(isCalendarEventCacheEntry) &&
  value.entries.reduce(
    (count, entry) => count + entry.events.length,
    0,
  ) <= MAX_CACHE_EVENTS;

function toJson(value: unknown): MiniAppJsonValue {
  return JSON.parse(JSON.stringify(value)) as MiniAppJsonValue;
}

function assertExecutionContext(
  value: unknown,
): asserts value is CalendarMcpExecutionContext {
  if (!isRecord(value)) calendarMcpError("the execution context is malformed.");
  for (const key of ["channelId", "userId"] as const) {
    const identifier = value[key];
    if (
      identifier !== null &&
      (typeof identifier !== "string" ||
        !identifier.trim() ||
        identifier.length > 256 ||
        CONTROL_CHARACTER.test(identifier))
    ) {
      calendarMcpError(`the execution context ${key} is malformed.`);
    }
  }
}

function decodeStoredValue(
  entry: MiniAppStorageEntry,
  label: string,
): unknown | null {
  if (entry.value === null) return null;

  let decoded: unknown = entry.value;
  if (typeof entry.value === "string") {
    if (entry.value.length > MAX_STORED_BYTES) {
      calendarMcpError(`the stored ${label} exceeds the read limit.`);
    }
    try {
      decoded = JSON.parse(entry.value) as unknown;
    } catch {
      calendarMcpError(`the stored ${label} is not valid JSON.`);
    }
  } else if (JSON.stringify(entry.value).length > MAX_STORED_BYTES) {
    calendarMcpError(`the stored ${label} exceeds the read limit.`);
  }
  return decoded;
}

interface LoadedCalendarData {
  readonly state: CalendarState | null;
  readonly eventCache: CalendarEventCacheSnapshot | null;
}

async function loadCalendarData(
  runtime: CalendarMcpRuntime,
): Promise<LoadedCalendarData> {
  const context = await runtime.getExecutionContext();
  assertExecutionContext(context);
  if (context.userId === null) {
    calendarMcpError("the host did not provide a canonical user identity.");
  }
  const addresses = calendarPrincipalStorageAddresses(context.userId);
  const stateValue = decodeStoredValue(
    await runtime.readStorage(addresses.state),
    "calendar state",
  );
  const eventCacheValue = decodeStoredValue(
    await runtime.readStorage(addresses.eventCache),
    "provider event cache",
  );

  if (stateValue !== null && !isCalendarState(stateValue)) {
    calendarMcpError("the stored calendar state is malformed.");
  }
  if (
    eventCacheValue !== null &&
    !isCalendarEventCacheSnapshot(eventCacheValue)
  ) {
    calendarMcpError("the stored provider event cache is malformed or unbounded.");
  }
  return {
    state: stateValue,
    eventCache: eventCacheValue,
  };
}

function argumentsRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("Tool arguments must be a JSON object.");
  return value;
}

function boundedString(
  value: unknown,
  name: string,
  options: { readonly required?: boolean; readonly maxLength?: number } = {},
): string {
  if (value === undefined && !options.required) return "";
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const trimmed = value.trim();
  if (options.required && !trimmed) throw new Error(`${name} is required.`);
  if (
    trimmed.length > (options.maxLength ?? 256) ||
    CONTROL_CHARACTER.test(trimmed)
  ) {
    throw new Error(`${name} is malformed.`);
  }
  return trimmed;
}

function timestamp(value: unknown, name: string, required = false): string {
  const result = boundedString(value, name, { required, maxLength: 64 });
  if (result && !Number.isFinite(Date.parse(result))) {
    throw new Error(`${name} must be a valid timestamp.`);
  }
  return result;
}

function stringIds(value: unknown, name: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error(`${name} must contain at most 100 identifiers.`);
  }
  return Array.from(
    new Set(
      value.map((identifier, index) =>
        boundedString(identifier, `${name}[${index}]`, {
          required: true,
          maxLength: 256,
        }),
      ),
    ),
  );
}

function finiteInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function calendarDate(value: unknown): string {
  const result = boundedString(value, "date", { required: true, maxLength: 10 });
  const match = DATE.exec(result);
  if (!match) throw new Error("date must use YYYY-MM-DD.");
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error("date must be a real calendar date.");
  }
  return result;
}

function eventSummary(
  event: CalendarEvent,
  calendar: ConnectedCalendar,
) {
  const freeBusyOnly = calendar.role === "free-busy";
  return {
    id: event.id,
    calendar: {
      id: calendar.id,
      name: calendar.name,
      role: calendar.role,
    },
    title:
      freeBusyOnly || event.kind === "work-block" ? "Busy" : event.title,
    start: event.start,
    end: event.end,
    kind: freeBusyOnly ? "meeting" : event.kind,
    status: event.status,
    attendeeCount: freeBusyOnly ? null : event.attendees.length,
    redacted: freeBusyOnly || event.kind === "work-block",
  };
}

interface CalendarCacheCoverage {
  readonly source: "gateway-d1-cache-mirror" | "unavailable";
  readonly selectedEntries: ReadonlyMap<string, CalendarEventCacheEntry>;
  readonly coveredCalendarIds: readonly string[];
  readonly missingCoverageCalendarIds: readonly string[];
  readonly staleCalendarIds: readonly string[];
  readonly oldestSyncedAt: string | null;
  readonly ageMs: number | null;
  readonly partial: boolean;
}

const eventOverlapsRange = (
  event: Pick<CalendarEvent, "start" | "end">,
  start: string,
  end: string,
): boolean => Date.parse(event.end) > Date.parse(start) && Date.parse(event.start) < Date.parse(end);

const entryCoversRange = (
  entry: CalendarEventCacheEntry,
  start: string,
  end: string,
): boolean => Date.parse(entry.timeMin) <= Date.parse(start) && Date.parse(entry.timeMax) >= Date.parse(end);

const cacheTimestampFresh = (value: string, now: number): boolean => {
  const age = now - Date.parse(value);
  return age >= -MAX_FUTURE_CLOCK_SKEW_MS && age <= FRESH_CACHE_AGE_MS;
};

function assessCalendarCacheCoverage(
  cache: CalendarEventCacheSnapshot | null,
  calendarIds: readonly string[],
  start: string,
  end: string,
  now: number,
): CalendarCacheCoverage {
  const normalizedIds = [...new Set(calendarIds)].sort((left, right) =>
    left.localeCompare(right),
  );
  const selectedEntries = new Map<string, CalendarEventCacheEntry>();
  const coveredCalendarIds: string[] = [];
  const missingCoverageCalendarIds: string[] = [];
  const staleCalendarIds: string[] = [];
  const syncedTimes: string[] = [];

  for (const calendarId of normalizedIds) {
    const candidates = (cache?.entries ?? [])
      .filter(entry =>
        !entry.partial &&
        entry.calendarIds.includes(calendarId) &&
        entryCoversRange(entry, start, end) &&
        Boolean(entry.calendarSyncedAt[calendarId]),
      )
      .sort((left, right) =>
        (right.calendarSyncedAt[calendarId] ?? "").localeCompare(
          left.calendarSyncedAt[calendarId] ?? "",
        ) || right.updatedAt.localeCompare(left.updatedAt),
      );
    const selected = candidates[0];
    if (!selected) {
      missingCoverageCalendarIds.push(calendarId);
      continue;
    }
    const syncedAt = selected.calendarSyncedAt[calendarId]!;
    selectedEntries.set(calendarId, selected);
    coveredCalendarIds.push(calendarId);
    syncedTimes.push(syncedAt);
    if (!cacheTimestampFresh(syncedAt, now)) staleCalendarIds.push(calendarId);
  }

  const oldestSyncedAt = syncedTimes.sort()[0] ?? null;
  return {
    source: cache ? "gateway-d1-cache-mirror" : "unavailable",
    selectedEntries,
    coveredCalendarIds,
    missingCoverageCalendarIds,
    staleCalendarIds,
    oldestSyncedAt,
    ageMs: oldestSyncedAt === null
      ? null
      : Math.max(0, now - Date.parse(oldestSyncedAt)),
    partial: missingCoverageCalendarIds.length > 0,
  };
}

function cacheStatus(coverage: CalendarCacheCoverage) {
  return {
    source: coverage.source,
    ageMs: coverage.ageMs,
    oldestSyncedAt: coverage.oldestSyncedAt,
    partial: coverage.partial,
    coveredCalendarIds: coverage.coveredCalendarIds,
    missingCoverageCalendarIds: coverage.missingCoverageCalendarIds,
    staleCalendarIds: coverage.staleCalendarIds,
    freshnessLimitMs: FRESH_CACHE_AGE_MS,
  };
}

function cachedEventsForCoverage(
  coverage: CalendarCacheCoverage,
  start: string,
  end: string,
): readonly CalendarEvent[] {
  const events = new Map<string, CalendarEvent>();
  for (const [calendarId, entry] of coverage.selectedEntries) {
    for (const event of entry.events) {
      if (
        event.calendarId === calendarId &&
        eventOverlapsRange(event, start, end)
      ) {
        events.set(`${event.calendarId}\u001f${event.id}`, event);
      }
    }
  }
  return [...events.values()];
}

function cachedEventsForList(
  cache: CalendarEventCacheSnapshot | null,
  calendarIds: ReadonlySet<string>,
  start: string,
  end: string,
): readonly CalendarEvent[] {
  const events = new Map<string, CalendarEvent>();
  for (const entry of cache?.entries ?? []) {
    if (
      (start && Date.parse(entry.timeMax) <= Date.parse(start)) ||
      (end && Date.parse(entry.timeMin) >= Date.parse(end))
    ) {
      continue;
    }
    for (const event of entry.events) {
      if (
        calendarIds.has(event.calendarId) &&
        (!start || Date.parse(event.end) > Date.parse(start)) &&
        (!end || Date.parse(event.start) < Date.parse(end))
      ) {
        events.set(`${event.calendarId}\u001f${event.id}`, event);
      }
    }
  }
  return [...events.values()];
}

function mergeCalendarEvents(
  localEvents: readonly CalendarEvent[],
  cachedEvents: readonly CalendarEvent[],
): readonly CalendarEvent[] {
  const events = new Map<string, CalendarEvent>();
  for (const event of localEvents) {
    events.set(`${event.calendarId}\u001f${event.id}`, event);
  }
  // The D1-origin cache mirror wins duplicate provider identities while TAP-only
  // events remain present until the gateway returns their provider copy.
  for (const event of cachedEvents) {
    events.set(`${event.calendarId}\u001f${event.id}`, event);
  }
  return [...events.values()];
}

function listCacheCoverage(
  cache: CalendarEventCacheSnapshot | null,
  calendarIds: readonly string[],
  start: string,
  end: string,
  now: number,
): CalendarCacheCoverage {
  if (start && end) {
    return assessCalendarCacheCoverage(cache, calendarIds, start, end, now);
  }

  const selectedEntries = new Map<string, CalendarEventCacheEntry>();
  const staleCalendarIds: string[] = [];
  const syncedTimes: string[] = [];
  for (const calendarId of [...new Set(calendarIds)].sort()) {
    const selected = (cache?.entries ?? [])
      .filter(entry => entry.calendarIds.includes(calendarId))
      .sort((left, right) =>
        (right.calendarSyncedAt[calendarId] ?? "").localeCompare(
          left.calendarSyncedAt[calendarId] ?? "",
        ),
      )[0];
    const syncedAt = selected?.calendarSyncedAt[calendarId];
    if (!selected || !syncedAt) continue;
    selectedEntries.set(calendarId, selected);
    syncedTimes.push(syncedAt);
    if (!cacheTimestampFresh(syncedAt, now)) staleCalendarIds.push(calendarId);
  }
  const oldestSyncedAt = syncedTimes.sort()[0] ?? null;
  return {
    source: cache ? "gateway-d1-cache-mirror" : "unavailable",
    selectedEntries,
    coveredCalendarIds: [],
    missingCoverageCalendarIds: calendarIds,
    staleCalendarIds,
    oldestSyncedAt,
    ageMs: oldestSyncedAt === null ? null : Math.max(0, now - Date.parse(oldestSyncedAt)),
    // An unbounded list cannot claim complete coverage over an LRU range cache.
    partial: calendarIds.length > 0,
  };
}

function parseAttendees(
  value: unknown,
  errors: string[],
): readonly CalendarAttendee[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    errors.push("Add between one and 100 attendees.");
    return [];
  }
  const attendees: CalendarAttendee[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate)) {
      errors.push(`Attendee ${index + 1} must be an object.`);
      continue;
    }
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const email = typeof candidate.email === "string" ? candidate.email.trim() : "";
    const kind = candidate.kind;
    if (!id || id.length > 256 || CONTROL_CHARACTER.test(id)) {
      errors.push(`Attendee ${index + 1} needs a valid ID.`);
    } else if (ids.has(id)) {
      errors.push(`Attendee ${index + 1} duplicates another attendee ID.`);
    }
    if (!name || name.length > 160 || CONTROL_CHARACTER.test(name)) {
      errors.push(`Attendee ${index + 1} needs a valid name.`);
    }
    if (
      !email ||
      email.length > 320 ||
      CONTROL_CHARACTER.test(email) ||
      !/^[^\s@]+@[^\s@]+$/u.test(email)
    ) {
      errors.push(`Attendee ${index + 1} needs a valid email address.`);
    }
    if (kind !== "tap" && kind !== "external") {
      errors.push(`Attendee ${index + 1} kind must be tap or external.`);
    }
    if (
      id &&
      name &&
      email &&
      (kind === "tap" || kind === "external") &&
      !ids.has(id)
    ) {
      ids.add(id);
      attendees.push({
        id,
        name,
        email,
        kind,
        required: candidate.required !== false,
      });
    }
  }
  return attendees;
}

function calendarMcpTools(runtime: CalendarMcpRuntime) {
  return {
      list_events: {
        description:
          "List a bounded set of events from calendars currently visible in TAP Calendar. Free/busy calendars and Work Blocks are redacted, and attendee identities and linked TAP content are never returned.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            start: { type: "string", format: "date-time" },
            end: { type: "string", format: "date-time" },
            calendarIds: {
              type: "array",
              maxItems: 100,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 256 },
            },
          },
        },
        async execute(arguments_: unknown) {
          const input = argumentsRecord(arguments_);
          const start = timestamp(input.start, "start");
          const end = timestamp(input.end, "end");
          if (start && end && Date.parse(end) <= Date.parse(start)) {
            throw new Error("end must be after start.");
          }
          const requestedCalendarIds = stringIds(input.calendarIds, "calendarIds");
          const requested = new Set(requestedCalendarIds);
          const { state, eventCache } = await loadCalendarData(runtime);
          if (!state) {
            return toJson({
              schemaVersion: 1,
              stateAvailable: false,
              events: [],
              truncated: false,
              cache: {
                source: eventCache ? "gateway-d1-cache-mirror" : "unavailable",
                ageMs: null,
                oldestSyncedAt: null,
                partial: true,
                coveredCalendarIds: [],
                missingCoverageCalendarIds: requestedCalendarIds,
                staleCalendarIds: [],
                freshnessLimitMs: FRESH_CACHE_AGE_MS,
              },
            });
          }

          const calendars = new Map(
            allCalendars(state)
              .filter(calendar => calendar.visible)
              .filter(calendar => requested.size === 0 || requested.has(calendar.id))
              .map(calendar => [calendar.id, calendar] as const),
          );
          const localMatching = state.events
            .filter(event => calendars.has(event.calendarId))
            .filter(event => !start || Date.parse(event.end) > Date.parse(start))
            .filter(event => !end || Date.parse(event.start) < Date.parse(end));
          const cachedMatching = cachedEventsForList(
            eventCache,
            new Set(calendars.keys()),
            start,
            end,
          );
          const matching = [...mergeCalendarEvents(localMatching, cachedMatching)]
            .sort((left, right) =>
              left.start.localeCompare(right.start) || left.id.localeCompare(right.id),
            );
          const coverage = listCacheCoverage(
            eventCache,
            [...calendars.keys()],
            start,
            end,
            runtime.now?.() ?? Date.now(),
          );
          return toJson({
            schemaVersion: 1,
            stateAvailable: true,
            events: matching
              .slice(0, MAX_EVENTS)
              .map(event => eventSummary(event, calendars.get(event.calendarId)!)),
            truncated: matching.length > MAX_EVENTS,
            cache: cacheStatus(coverage),
            sources: {
              tapStateEventCount: localMatching.length,
              gatewayD1CacheMirrorEventCount: cachedMatching.length,
            },
          });
        },
      },
      summarize_day: {
        description:
          "Return privacy-safe Calendar time totals for one local date so a daily summary can report scheduled Meetings & appointments and Focused work. Present numeric totals only when safeToPresent and dataStatus.complete are both true; incomplete, stale, or unverified data suppresses totals. The tool reads only calendars owned by the current TAP user and never returns event titles, attendees, task links, event IDs, or calendar names. Calendar time does not prove attendance or productive activity.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            timeZone: { type: "string", minLength: 1, maxLength: 128 },
            calendarIds: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              uniqueItems: true,
              description:
                "Optional subset of calendars owned by the current user. Omit to summarize every owned calendar.",
              items: { type: "string", minLength: 1, maxLength: 256 },
            },
          },
          required: ["date", "timeZone"],
        },
        async execute(arguments_: unknown) {
          const input = argumentsRecord(arguments_);
          const date = calendarDate(input.date);
          const timeZone = boundedString(input.timeZone, "timeZone", {
            required: true,
            maxLength: 128,
          });
          const requestedCalendarIds = stringIds(input.calendarIds, "calendarIds");
          if (input.calendarIds !== undefined && requestedCalendarIds.length === 0) {
            throw new Error("calendarIds must contain at least one owned calendar ID when provided.");
          }
          const requested = new Set(requestedCalendarIds);
          const dayRange = resolveDailySummaryDay(date, timeZone);
          if (!dayRange) {
            throw new Error(
              `The local date cannot be resolved in the requested IANA time zone (${timeZone}).`,
            );
          }

          const now = runtime.now?.() ?? Date.now();
          const { state, eventCache } = await loadCalendarData(runtime);
          if (!state) {
            return toJson({
              schemaVersion: 1,
              stateAvailable: false,
              date,
              timeZone,
              periodStart: dayRange.start,
              periodEnd: dayRange.end,
              asOf: new Date(now).toISOString(),
              scheduled: null,
              elapsed: null,
              eventCounts: null,
              safeToPresent: false,
              dataStatus: {
                status: "unavailable",
                complete: false,
                includedCalendarCount: 0,
                missingCalendarCount: 0,
                staleCalendarCount: 0,
                oldestSyncedAt: null,
              },
              basis: "scheduled-calendar-time",
              warning: "Calendar data is unavailable, so no time totals can be presented.",
              disclaimer:
                "Calendar time is unavailable and does not prove attendance or productive activity.",
            });
          }

          const ownedCalendars = allCalendars(state).filter(
            calendar => calendar.role === "owner",
          );
          const ownedCalendarIds = new Set(ownedCalendars.map(calendar => calendar.id));
          const invalidRequestedIds = requestedCalendarIds.filter(
            calendarId => !ownedCalendarIds.has(calendarId),
          );
          if (invalidRequestedIds.length > 0) {
            throw new Error(
              "calendarIds may contain only calendars owned by the current TAP user.",
            );
          }
          const includedCalendars = ownedCalendars.filter(
            calendar => requested.size === 0 || requested.has(calendar.id),
          );
          const includedCalendarIds = includedCalendars.map(calendar => calendar.id);
          if (includedCalendarIds.length === 0) {
            return toJson({
              schemaVersion: 1,
              stateAvailable: true,
              date,
              timeZone,
              periodStart: dayRange.start,
              periodEnd: dayRange.end,
              asOf: new Date(now).toISOString(),
              scheduled: null,
              elapsed: null,
              eventCounts: null,
              safeToPresent: false,
              dataStatus: {
                status: "unavailable",
                complete: false,
                includedCalendarCount: 0,
                missingCalendarCount: 0,
                staleCalendarCount: 0,
                unverifiedLocalEventCount: 0,
                oldestSyncedAt: null,
              },
              basis: "scheduled-calendar-time",
              reason: "No calendars owned by the current TAP user are connected.",
              warning: "No owned calendar is connected, so no time totals can be presented.",
              disclaimer:
                "Calendar time is unavailable and does not prove attendance or productive activity.",
            });
          }
          const included = new Set(includedCalendarIds);
          const coverage = assessCalendarCacheCoverage(
            eventCache,
            includedCalendarIds,
            dayRange.start,
            dayRange.end,
            now,
          );
          const localEvents = state.events.filter(
            event =>
              included.has(event.calendarId) &&
              eventOverlapsRange(event, dayRange.start, dayRange.end),
          );
          const cachedEvents = cachedEventsForCoverage(
            coverage,
            dayRange.start,
            dayRange.end,
          );
          const cachedEventKeys = new Set(
            cachedEvents.map(event => `${event.calendarId}\u001f${event.id}`),
          );
          const unverifiedLocalEventCount = localEvents.filter(
            event => !cachedEventKeys.has(`${event.calendarId}\u001f${event.id}`),
          ).length;
          const events = mergeCalendarEvents(localEvents, cachedEvents);
          const allocation = calculateDailyTimeAllocation({
            events,
            periodStart: dayRange.start,
            periodEnd: dayRange.end,
            asOf: now,
          });
          const stateStaleCalendarIds = includedCalendars
            .filter(calendar => calendar.freshness === "stale")
            .map(calendar => calendar.id);
          const staleCalendarIds = new Set([
            ...stateStaleCalendarIds,
            ...coverage.staleCalendarIds,
          ]);
          const status = coverage.missingCoverageCalendarIds.length > 0
            ? "partial"
            : staleCalendarIds.size > 0
              ? "stale"
              : unverifiedLocalEventCount > 0
                ? "unverified"
                : "complete";
          const safeToPresent = status === "complete";

          return toJson({
            schemaVersion: 1,
            stateAvailable: true,
            date,
            timeZone,
            periodStart: allocation.periodStart,
            periodEnd: allocation.periodEnd,
            asOf: allocation.asOf,
            scheduled: safeToPresent ? allocation.scheduled : null,
            elapsed: safeToPresent ? allocation.elapsed : null,
            eventCounts: safeToPresent ? allocation.eventCounts : null,
            safeToPresent,
            dataStatus: {
              status,
              complete: safeToPresent,
              includedCalendarCount: includedCalendarIds.length,
              missingCalendarCount: coverage.missingCoverageCalendarIds.length,
              staleCalendarCount: staleCalendarIds.size,
              unverifiedLocalEventCount,
              oldestSyncedAt: coverage.oldestSyncedAt,
            },
            basis: "scheduled-calendar-time",
            warning: safeToPresent
              ? null
              : "Calendar data is incomplete, stale, or unverified; totals are suppressed because they may be low or wrong.",
            disclaimer:
              "Meetings & appointments and Focused work are inferred from confirmed timed calendar events; they do not prove attendance or productive activity.",
          });
        },
      },
      find_available_slots: {
        description:
          "Find candidate slots from one TAP Calendar Availability Schedule using complete D1-cache-mirror coverage no older than five minutes for every Conflict Calendar. Results fail closed on missing, partial, or stale cache data and always require final live gateway confirmation.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            timezoneOffset: {
              type: "string",
              pattern: "^[+-]\\d{2}:\\d{2}$",
              deprecated: true,
              description: "Deprecated compatibility input. TAP ignores this value and uses the stored schedule or travel-override IANA time zone.",
            },
            durationMinutes: { type: "integer", minimum: 5, maximum: 480 },
            intervalMinutes: { type: "integer", minimum: 5, maximum: 240 },
            scheduleId: { type: "string", minLength: 1, maxLength: 256 },
            calendarIds: {
              type: "array",
              maxItems: 100,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 256 },
            },
          },
          required: ["date", "durationMinutes"],
        },
        async execute(arguments_: unknown) {
          const input = argumentsRecord(arguments_);
          const date = calendarDate(input.date);
          const durationMinutes = finiteInteger(
            input.durationMinutes,
            "durationMinutes",
            5,
            480,
          );
          const intervalMinutes = finiteInteger(
            input.intervalMinutes,
            "intervalMinutes",
            5,
            240,
            30,
          );
          const scheduleId = boundedString(input.scheduleId, "scheduleId", {
            maxLength: 256,
          });
          const requestedCalendarIds = new Set(
            stringIds(input.calendarIds, "calendarIds"),
          );
          const { state, eventCache } = await loadCalendarData(runtime);
          if (!state) {
            return toJson({
              schemaVersion: 1,
              stateAvailable: false,
              slots: [],
              blockedByStaleCalendarIds: [],
              blockedByIncompleteCacheCalendarIds: [],
              cache: {
                source: eventCache ? "gateway-d1-cache-mirror" : "unavailable",
                ageMs: null,
                oldestSyncedAt: null,
                partial: true,
                coveredCalendarIds: [],
                missingCoverageCalendarIds: [],
                staleCalendarIds: [],
                freshnessLimitMs: FRESH_CACHE_AGE_MS,
              },
              requiresLiveGatewayConfirmation: true,
              confirmationPolicy: LIVE_CONFIRMATION_POLICY,
            });
          }

          const schedule = state.availability.find(
            candidate => candidate.id === (scheduleId || state.activeAvailabilityId),
          );
          if (!schedule) throw new Error("The requested Availability Schedule was not found.");
          const dateAvailability = availabilityForDate(schedule, date);
          const availabilityTimezone = dateAvailability.timeZone;
          const policyNow = runtime.now?.() ?? Date.now();
          const localNow = ianaZonedInstant(policyNow, schedule.timezone);
          if (!localNow.ok) {
            throw new Error(
              `The current date cannot be resolved in ${schedule.timezone}: ${localNow.reason}.`,
            );
          }
          const requestedDayIndex = Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86_400_000);
          const todayIndex = Math.floor(Date.parse(`${localNow.date}T00:00:00.000Z`) / 86_400_000);
          const dateInsideBookingHorizon = requestedDayIndex >= todayIndex &&
            requestedDayIndex < todayIndex + schedule.bookingHorizonDays;
          // Explicit IDs may add conservative constraints, but can never
          // remove a configured Conflict Calendar or bypass its stale state.
          const conflictCalendars = allCalendars(state).filter(
            calendar => calendar.conflicts || requestedCalendarIds.has(calendar.id),
          );
          const conflictCalendarIds = conflictCalendars.map(calendar => calendar.id);
          const stateStaleCalendarIds = conflictCalendars
            .filter(calendar => calendar.freshness === "stale")
            .map(calendar => calendar.id);

          if (!dateInsideBookingHorizon) {
            return toJson({
              schemaVersion: 1,
              stateAvailable: true,
              scheduleId: schedule.id,
              scheduleTimezone: schedule.timezone,
              availabilityTimezone,
              slots: [],
              conflictCalendarIds,
              blockedByStaleCalendarIds: [],
              blockedByIncompleteCacheCalendarIds: [],
              cache: {
                source: eventCache ? "gateway-d1-cache-mirror" : "unavailable",
                ageMs: null,
                oldestSyncedAt: null,
                partial: false,
                coveredCalendarIds: [],
                missingCoverageCalendarIds: [],
                staleCalendarIds: [],
                freshnessLimitMs: FRESH_CACHE_AGE_MS,
              },
              reason: "The requested date is outside this Availability Schedule's booking horizon.",
              requiresLiveGatewayConfirmation: true,
              confirmationPolicy: LIVE_CONFIRMATION_POLICY,
            });
          }

          const override = dateAvailability.override;
          if (override && !override.available) {
            const dayRange = resolveAvailabilityDay(date, availabilityTimezone);
            if (!dayRange) {
              throw new Error(
                `The local date cannot be resolved unambiguously in ${availabilityTimezone}.`,
              );
            }
            const coverage = assessCalendarCacheCoverage(
              eventCache,
              conflictCalendarIds,
              dayRange.start,
              dayRange.end,
              runtime.now?.() ?? Date.now(),
            );
            return toJson({
              schemaVersion: 1,
              stateAvailable: true,
              scheduleId: schedule.id,
              scheduleTimezone: schedule.timezone,
              availabilityTimezone,
              slots: [],
              conflictCalendarIds,
              blockedByStaleCalendarIds: stateStaleCalendarIds,
              blockedByIncompleteCacheCalendarIds:
                coverage.missingCoverageCalendarIds,
              cache: cacheStatus(coverage),
              reason: `Availability is closed by the date override: ${override.label}.`,
              requiresLiveGatewayConfirmation: true,
              confirmationPolicy: LIVE_CONFIRMATION_POLICY,
            });
          }

          const windows = dateAvailability.windows;
          if (windows.length === 0) {
            const dayRange = resolveAvailabilityDay(date, availabilityTimezone);
            if (!dayRange) {
              throw new Error(
                `The local date cannot be resolved unambiguously in ${availabilityTimezone}.`,
              );
            }
            const coverage = assessCalendarCacheCoverage(
              eventCache,
              conflictCalendarIds,
              dayRange.start,
              dayRange.end,
              runtime.now?.() ?? Date.now(),
            );
            return toJson({
              schemaVersion: 1,
              stateAvailable: true,
              scheduleId: schedule.id,
              scheduleTimezone: schedule.timezone,
              availabilityTimezone,
              slots: [],
              conflictCalendarIds,
              blockedByStaleCalendarIds: stateStaleCalendarIds,
              blockedByIncompleteCacheCalendarIds:
                coverage.missingCoverageCalendarIds,
              cache: cacheStatus(coverage),
              requiresLiveGatewayConfirmation: true,
              confirmationPolicy: LIVE_CONFIRMATION_POLICY,
            });
          }

          const windowStart = windows.reduce(
            (earliest, window) => window.start < earliest ? window.start : earliest,
            windows[0]!.start,
          );
          const windowEnd = windows.reduce(
            (latest, window) => window.end > latest ? window.end : latest,
            windows[0]!.end,
          );
          const range = resolveAvailabilityRange(
            date,
            windowStart,
            windowEnd,
            availabilityTimezone,
          );
          if (!range) {
            throw new Error(
              `Availability boundaries cannot be resolved unambiguously in ${availabilityTimezone}.`,
            );
          }
          const rangeStart = new Date(
            Date.parse(range.start) - schedule.bufferBeforeMinutes * 60_000,
          ).toISOString();
          const rangeEnd = new Date(
            Date.parse(range.end) + schedule.bufferAfterMinutes * 60_000,
          ).toISOString();
          const coverage = assessCalendarCacheCoverage(
            eventCache,
            conflictCalendarIds,
            rangeStart,
            rangeEnd,
            runtime.now?.() ?? Date.now(),
          );
          const blockedByStaleCalendarIds = [...new Set([
            ...stateStaleCalendarIds,
            ...coverage.staleCalendarIds,
          ])].sort();
          if (
            blockedByStaleCalendarIds.length > 0 ||
            coverage.missingCoverageCalendarIds.length > 0
          ) {
            return toJson({
              schemaVersion: 1,
              stateAvailable: true,
              scheduleId: schedule.id,
              scheduleTimezone: schedule.timezone,
              availabilityTimezone,
              slots: [],
              conflictCalendarIds,
              blockedByStaleCalendarIds,
              blockedByIncompleteCacheCalendarIds:
                coverage.missingCoverageCalendarIds,
              cache: cacheStatus(coverage),
              reason: coverage.missingCoverageCalendarIds.length > 0
                ? "Availability is closed because complete cache coverage is missing for a Conflict Calendar."
                : "Availability is closed because a Conflict Calendar cache is older than five minutes.",
              requiresLiveGatewayConfirmation: true,
              confirmationPolicy: LIVE_CONFIRMATION_POLICY,
            });
          }

          const conflictIds = new Set(conflictCalendarIds);
          const localBusy = state.events.filter(
            event =>
              conflictIds.has(event.calendarId) &&
              event.status !== "cancelled" &&
              event.status !== "declined" &&
              event.busy !== false &&
              eventOverlapsRange(event, rangeStart, rangeEnd),
          );
          const cachedBusy = cachedEventsForCoverage(
            coverage,
            rangeStart,
            rangeEnd,
          ).filter(event =>
            event.status !== "cancelled" &&
            event.status !== "declined" &&
            event.busy !== false,
          );
          const busy = mergeCalendarEvents(localBusy, cachedBusy);
          const uniqueSlots = new Map<string, { start: string; end: string }>();
          for (const window of windows) {
            const windowSlots = calculateAvailableSlots({
              date,
              timeZone: availabilityTimezone,
              durationMinutes,
              intervalMinutes,
              windowStart: window.start,
              windowEnd: window.end,
              busy,
              bufferBeforeMinutes: schedule.bufferBeforeMinutes,
              bufferAfterMinutes: schedule.bufferAfterMinutes,
            });
            for (const slot of windowSlots) {
              uniqueSlots.set(`${slot.start}\u0000${slot.end}`, slot);
            }
          }
          const noticeCutoff = policyNow + schedule.minimumNoticeMinutes * 60_000;
          const preferredStart = minutesFromMidnight(schedule.preferredStart);
          const preferredEnd = minutesFromMidnight(schedule.preferredEnd);
          const policySlots = [...uniqueSlots.values()].flatMap(slot => {
            const start = Date.parse(slot.start);
            if (!dateInsideBookingHorizon || !Number.isFinite(start) || start < noticeCutoff) {
              return [];
            }
            const localStart = ianaZonedInstant(start, availabilityTimezone);
            if (!localStart.ok) return [];
            const minute = localStart.hour * 60 + localStart.minute;
            return [{
              slot,
              preferred: preferredStart < preferredEnd &&
                minute >= preferredStart &&
                minute < preferredEnd,
            }];
          });
          const slots = policySlots
            .sort((left, right) =>
              Number(right.preferred) - Number(left.preferred) ||
              left.slot.start.localeCompare(right.slot.start) ||
              left.slot.end.localeCompare(right.slot.end)
            )
            .map(candidate => candidate.slot)
            .slice(0, MAX_SLOTS);
          return toJson({
            schemaVersion: 1,
            stateAvailable: true,
            scheduleId: schedule.id,
            scheduleTimezone: schedule.timezone,
            availabilityTimezone,
            slots,
            conflictCalendarIds,
            blockedByStaleCalendarIds: [],
            blockedByIncompleteCacheCalendarIds: [],
            cache: cacheStatus(coverage),
            ...(slots.length === 0 && uniqueSlots.size > 0
              ? {
                  reason: "No free times remain after applying the minimum booking notice.",
                }
              : {}),
            requiresLiveGatewayConfirmation: true,
            confirmationPolicy: LIVE_CONFIRMATION_POLICY,
          });
        },
      },
      draft_meeting: {
        description:
          "Prepare a meeting draft for explicit human review, including advisory conflict and cache-staleness details from the D1 cache mirror. This tool never creates a Booking, hold, event, replica, or notification, and the live gateway must confirm availability before booking.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 160 },
            calendarId: { type: "string", minLength: 1, maxLength: 256 },
            start: { type: "string", format: "date-time" },
            end: { type: "string", format: "date-time" },
            meetingProvider: {
              type: "string",
              enum: Array.from(meetingProviders),
            },
            attendees: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string", minLength: 1, maxLength: 256 },
                  name: { type: "string", minLength: 1, maxLength: 160 },
                  email: { type: "string", minLength: 3, maxLength: 320 },
                  kind: { type: "string", enum: ["tap", "external"] },
                  required: { type: "boolean" },
                },
                required: ["id", "name", "email", "kind", "required"],
              },
            },
            approvalRequired: { type: "boolean" },
            eventTypeId: { type: "string", minLength: 1, maxLength: 256 },
          },
          required: ["title", "calendarId", "start", "end", "meetingProvider", "attendees"],
        },
        async execute(arguments_: unknown) {
          const input = argumentsRecord(arguments_);
          const errors: string[] = [];
          const warnings: string[] = [];
          const title = typeof input.title === "string" ? input.title.trim() : "";
          const calendarId =
            typeof input.calendarId === "string" ? input.calendarId.trim() : "";
          const start = typeof input.start === "string" ? input.start.trim() : "";
          const end = typeof input.end === "string" ? input.end.trim() : "";
          const meetingProvider = input.meetingProvider;
          const attendees = parseAttendees(input.attendees, errors);

          if (!title || title.length > 160 || CONTROL_CHARACTER.test(title)) {
            errors.push("Meeting title must contain between one and 160 safe characters.");
          }
          if (
            !calendarId ||
            calendarId.length > 256 ||
            CONTROL_CHARACTER.test(calendarId)
          ) {
            errors.push("A valid Destination Calendar ID is required.");
          }
          if (!start || !Number.isFinite(Date.parse(start))) {
            errors.push("Meeting start must be a valid timestamp.");
          }
          if (!end || !Number.isFinite(Date.parse(end))) {
            errors.push("Meeting end must be a valid timestamp.");
          }
          if (
            start &&
            end &&
            Number.isFinite(Date.parse(start)) &&
            Number.isFinite(Date.parse(end)) &&
            Date.parse(end) <= Date.parse(start)
          ) {
            errors.push("Meeting end must be after its start.");
          }
          if (typeof meetingProvider !== "string" || !meetingProviders.has(meetingProvider as MeetingLocation)) {
            errors.push("Choose a supported Meeting Location.");
          }

          const { state, eventCache } = await loadCalendarData(runtime);
          if (!state) {
            errors.push("Calendar state is unavailable, so the Destination Calendar cannot be validated.");
          } else {
            const calendar = allCalendars(state).find(candidate => candidate.id === calendarId);
            if (!calendar?.writable) {
              errors.push("Choose a writable Destination Calendar.");
            }
          }
          if (
            typeof meetingProvider === "string" &&
            meetingProviders.has(meetingProvider as MeetingLocation)
          ) {
            const compatibility = guestCompatibilityError(
              meetingProvider as MeetingLocation,
              attendees,
            );
            if (compatibility) warnings.push(compatibility);
          }
          if (attendees.some(attendee => attendee.kind === "external")) {
            warnings.push(
              "External Guest email addresses are accepted without verification; review them before confirming.",
            );
          }

          const parsedStart = Date.parse(start);
          const parsedEnd = Date.parse(end);
          const validRange = Number.isFinite(parsedStart) &&
            Number.isFinite(parsedEnd) &&
            parsedEnd > parsedStart;
          let cacheAssessment: Record<string, unknown> = {
            source: eventCache ? "gateway-d1-cache-mirror" : "unavailable",
            ageMs: null,
            oldestSyncedAt: null,
            partial: true,
            coveredCalendarIds: [],
            missingCoverageCalendarIds: [],
            staleCalendarIds: [],
            freshnessLimitMs: FRESH_CACHE_AGE_MS,
            completeAndFresh: false,
            overlappingEventCount: 0,
            conflicts: [],
          };
          if (state && validRange) {
            const calendarMap = new Map(
              allCalendars(state).map(calendar => [calendar.id, calendar] as const),
            );
            const conflictCalendars = [...calendarMap.values()].filter(
              calendar => calendar.conflicts || calendar.id === calendarId,
            );
            const conflictCalendarIds = conflictCalendars.map(calendar => calendar.id);
            const coverage = assessCalendarCacheCoverage(
              eventCache,
              conflictCalendarIds,
              start,
              end,
              runtime.now?.() ?? Date.now(),
            );
            const stateStaleCalendarIds = conflictCalendars
              .filter(calendar => calendar.freshness === "stale")
              .map(calendar => calendar.id);
            const staleCalendarIds = [...new Set([
              ...stateStaleCalendarIds,
              ...coverage.staleCalendarIds,
            ])].sort();
            const conflictIds = new Set(conflictCalendarIds);
            const localEvents = state.events.filter(event =>
              conflictIds.has(event.calendarId) &&
              event.status !== "cancelled" &&
              event.status !== "declined" &&
              event.busy !== false &&
              eventOverlapsRange(event, start, end),
            );
            const cachedEvents = cachedEventsForCoverage(
              coverage,
              start,
              end,
            ).filter(event =>
              event.status !== "cancelled" &&
              event.status !== "declined" &&
              event.busy !== false,
            );
            const overlaps = [...mergeCalendarEvents(localEvents, cachedEvents)]
              .sort((left, right) =>
                left.start.localeCompare(right.start) || left.id.localeCompare(right.id),
              );
            const summaries = overlaps
              .slice(0, MAX_DRAFT_CONFLICTS)
              .map(event => eventSummary(event, calendarMap.get(event.calendarId)!));
            const completeAndFresh =
              coverage.missingCoverageCalendarIds.length === 0 &&
              staleCalendarIds.length === 0;
            cacheAssessment = {
              ...cacheStatus(coverage),
              staleCalendarIds,
              completeAndFresh,
              overlappingEventCount: overlaps.length,
              conflicts: summaries,
              conflictsTruncated: overlaps.length > MAX_DRAFT_CONFLICTS,
            };
            if (coverage.missingCoverageCalendarIds.length > 0) {
              warnings.push(
                "The D1 cache mirror does not completely cover every Conflict Calendar for this time range.",
              );
            }
            if (staleCalendarIds.length > 0) {
              warnings.push(
                "At least one Conflict Calendar cache is stale or older than five minutes.",
              );
            }
            if (overlaps.length > 0) {
              warnings.push(
                `Cached calendar data shows ${overlaps.length} overlapping busy event${overlaps.length === 1 ? "" : "s"}.`,
              );
            }
          }
          warnings.push(LIVE_CONFIRMATION_POLICY);

          const eventTypeId =
            typeof input.eventTypeId === "string" ? input.eventTypeId.trim() : "";
          const draft = {
            title,
            calendarId,
            start,
            end,
            meetingProvider,
            attendees,
            approvalRequired: input.approvalRequired === true,
            ...(eventTypeId ? { eventTypeId } : {}),
          };
          return toJson({
            kind: "meeting-draft",
            schemaVersion: 1,
            valid: errors.length === 0,
            draft: errors.length === 0 ? draft : null,
            errors,
            warnings,
            cacheAssessment,
            requiresHumanConfirmation: true,
            requiresLiveGatewayConfirmation: true,
            confirmationPolicy: LIVE_CONFIRMATION_POLICY,
            writesPerformed: false,
          });
        },
      },
  };
}

export function createCalendarMcpServer(
  runtime: CalendarMcpRuntime = defaultRuntime,
) {
  const { summarize_day: _summarizeDay, ...tools } = calendarMcpTools(runtime);
  return defineMcpServer({ tools });
}

export function createDailySummaryMcpServer(
  runtime: CalendarMcpRuntime = defaultRuntime,
) {
  const { summarize_day } = calendarMcpTools(runtime);
  return defineMcpServer({ tools: { summarize_day } });
}

export const calendarMcpStorageAddresses = calendarPrincipalStorageAddresses;
