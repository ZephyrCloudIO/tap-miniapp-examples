import type { CalendarEvent } from "./domain";
import { isAttendeeResponse } from "./attendee-response";
import type { CalendarGatewayEventQueryResult } from "./gateway";

export const CALENDAR_EVENT_CACHE_SCHEMA_VERSION = 1 as const;

export const calendarEventCacheLimits = {
  maxEntries: 10,
  maxEvents: 4_000,
  maxBytes: 900 * 1_024,
} as const;

export interface CalendarEventRangeRequest {
  readonly key: string;
  readonly timeMin: string;
  readonly timeMax: string;
  readonly calendarIds: readonly string[];
}

export interface CalendarEventCacheEntry extends CalendarEventRangeRequest {
  readonly events: readonly CalendarEvent[];
  /** Client-observed successful refresh time for each requested calendar. */
  readonly calendarSyncedAt: Readonly<Record<string, string>>;
  readonly updatedAt: string;
  readonly lastFullSyncAt: string | null;
  readonly lastAccessedAt: string;
  readonly partial: boolean;
}

export interface CalendarEventCacheSnapshot {
  readonly schemaVersion: typeof CALENDAR_EVENT_CACHE_SCHEMA_VERSION;
  readonly entries: readonly CalendarEventCacheEntry[];
}

export interface CalendarRemovalTombstones {
  readonly generation: number;
  readonly removedAtGeneration: Readonly<Record<string, number>>;
  readonly restoredAtGeneration: Readonly<Record<string, number>>;
}

export interface CalendarEventCacheLimits {
  readonly maxEntries: number;
  readonly maxEvents: number;
  readonly maxBytes: number;
}

export type CalendarEventRequestMode = "wait" | "background";

export interface CalendarEventInFlightRequest<T> {
  requestedMode: CalendarEventRequestMode;
  promise: Promise<T>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isIsoDateTime = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isCalendarEvent = (value: unknown): value is CalendarEvent => {
  if (!isRecord(value)) return false;
  const source = value.source;
  const sourceValid = source === undefined || (
    isRecord(source) &&
    (source.kind === "task" || source.kind === "channel" || source.kind === "message") &&
    typeof source.id === "string" &&
    typeof source.label === "string"
  );
  const locationValid = value.location === null || (
    typeof value.location === "string" &&
    [
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
    ].includes(value.location)
  );
  return (
    typeof value.id === "string" &&
    typeof value.calendarId === "string" &&
    typeof value.title === "string" &&
    isIsoDateTime(value.start) &&
    isIsoDateTime(value.end) &&
    Date.parse(value.end) > Date.parse(value.start) &&
    (value.kind === "meeting" || value.kind === "work-block" || value.kind === "hold" || value.kind === "focus") &&
    (value.status === "pending" || value.status === "confirmed" || value.status === "declined" || value.status === "cancelled") &&
    locationValid &&
    Array.isArray(value.attendees) &&
    value.attendees.every(attendee => isRecord(attendee) &&
      typeof attendee.id === "string" &&
      typeof attendee.name === "string" &&
      typeof attendee.email === "string" &&
      (attendee.kind === "tap" || attendee.kind === "external") &&
      typeof attendee.required === "boolean" && isAttendeeResponse(attendee)) &&
    (value.busy === undefined || typeof value.busy === "boolean") &&
    (value.allDay === undefined || typeof value.allDay === "boolean") &&
    sourceValid
  );
};

export function normalizeCalendarEventIds(
  calendarIds: readonly string[],
): readonly string[] {
  return [...new Set(calendarIds.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function calendarEventRangeKey(input: {
  readonly timeMin: string;
  readonly timeMax: string;
  readonly calendarIds: readonly string[];
}): string {
  return JSON.stringify([
    CALENDAR_EVENT_CACHE_SCHEMA_VERSION,
    input.timeMin,
    input.timeMax,
    normalizeCalendarEventIds(input.calendarIds),
  ]);
}

export function createCalendarEventRangeRequest(input: {
  readonly timeMin: string;
  readonly timeMax: string;
  readonly calendarIds: readonly string[];
}): CalendarEventRangeRequest {
  const calendarIds = normalizeCalendarEventIds(input.calendarIds);
  return {
    key: calendarEventRangeKey({ ...input, calendarIds }),
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    calendarIds,
  };
}

const isCalendarEventCacheEntry = (
  value: unknown,
): value is CalendarEventCacheEntry => {
  if (!isRecord(value)) return false;
  if (
    typeof value.key !== "string" ||
    !isIsoDateTime(value.timeMin) ||
    !isIsoDateTime(value.timeMax) ||
    !Array.isArray(value.calendarIds) ||
    !value.calendarIds.every(calendarId => typeof calendarId === "string") ||
    !Array.isArray(value.events) ||
    !value.events.every(isCalendarEvent) ||
    !isRecord(value.calendarSyncedAt) ||
    !Object.values(value.calendarSyncedAt).every(isIsoDateTime) ||
    !isIsoDateTime(value.updatedAt) ||
    !(value.lastFullSyncAt === null || isIsoDateTime(value.lastFullSyncAt)) ||
    !isIsoDateTime(value.lastAccessedAt) ||
    typeof value.partial !== "boolean"
  ) {
    return false;
  }
  const calendarIds = [...value.calendarIds] as string[];
  const normalized = normalizeCalendarEventIds(calendarIds);
  return (
    normalized.length === calendarIds.length &&
    normalized.every((calendarId, index) => calendarId === calendarIds[index]) &&
    value.key === calendarEventRangeKey({
      timeMin: value.timeMin,
      timeMax: value.timeMax,
      calendarIds: normalized,
    })
  );
};

export function isCalendarEventCacheSnapshot(
  value: unknown,
): value is CalendarEventCacheSnapshot {
  return (
    isRecord(value) &&
    value.schemaVersion === CALENDAR_EVENT_CACHE_SCHEMA_VERSION &&
    Array.isArray(value.entries) &&
    value.entries.every(isCalendarEventCacheEntry)
  );
}

export function createEmptyCalendarEventCache(): CalendarEventCacheSnapshot {
  return {
    schemaVersion: CALENDAR_EVENT_CACHE_SCHEMA_VERSION,
    entries: [],
  };
}

export function createCalendarRemovalTombstones(): CalendarRemovalTombstones {
  return { generation: 0, removedAtGeneration: {}, restoredAtGeneration: {} };
}

export function tombstoneRemovedCalendar(
  tombstones: CalendarRemovalTombstones,
  calendarId: string,
): CalendarRemovalTombstones {
  const generation = tombstones.generation + 1;
  return {
    generation,
    removedAtGeneration: {
      ...tombstones.removedAtGeneration,
      [calendarId]: generation,
    },
    restoredAtGeneration: tombstones.restoredAtGeneration,
  };
}

export function isCalendarRemovalTombstoned(
  tombstones: CalendarRemovalTombstones,
  calendarId: string,
): boolean {
  const removedAt = tombstones.removedAtGeneration[calendarId] ?? 0;
  const restoredAt = tombstones.restoredAtGeneration[calendarId] ?? 0;
  return removedAt > restoredAt;
}

export function restoreRemovedCalendar(
  tombstones: CalendarRemovalTombstones,
  calendarId: string,
): CalendarRemovalTombstones {
  if (!isCalendarRemovalTombstoned(tombstones, calendarId)) return tombstones;
  const generation = tombstones.generation + 1;
  return {
    generation,
    removedAtGeneration: tombstones.removedAtGeneration,
    restoredAtGeneration: {
      ...tombstones.restoredAtGeneration,
      [calendarId]: generation,
    },
  };
}

export function calendarWasRemovedAfterGeneration(
  tombstones: CalendarRemovalTombstones,
  calendarId: string,
  generation: number,
): boolean {
  const removedAt = tombstones.removedAtGeneration[calendarId];
  return removedAt !== undefined && removedAt > generation;
}

export function findCalendarEventCacheEntry(
  cache: CalendarEventCacheSnapshot,
  key: string,
): CalendarEventCacheEntry | null {
  return cache.entries.find(entry => entry.key === key) ?? null;
}

/**
 * Reuses an exact range or the narrowest cached calendar-ID superset for the
 * same time window. Projection is deliberately strict so hidden calendars can
 * never contribute events or freshness metadata to the narrowed view.
 */
export function findReusableCalendarEventCacheEntry(
  cache: CalendarEventCacheSnapshot,
  request: CalendarEventRangeRequest,
): CalendarEventCacheEntry | null {
  if (request.calendarIds.length === 0) return null;
  const requestedIds = new Set(request.calendarIds);
  const candidate = [...cache.entries]
    .filter(entry =>
      entry.timeMin === request.timeMin &&
      entry.timeMax === request.timeMax &&
      request.calendarIds.every(calendarId => entry.calendarIds.includes(calendarId))
    )
    .sort((left, right) =>
      left.calendarIds.length - right.calendarIds.length ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.lastAccessedAt.localeCompare(left.lastAccessedAt) ||
      left.key.localeCompare(right.key)
    )[0];
  if (!candidate) return null;
  return {
    ...candidate,
    ...request,
    events: candidate.events.filter(event => requestedIds.has(event.calendarId)),
    calendarSyncedAt: Object.fromEntries(
      request.calendarIds.flatMap(calendarId => {
        const syncedAt = candidate.calendarSyncedAt[calendarId];
        return syncedAt ? [[calendarId, syncedAt] as const] : [];
      }),
    ),
  };
}

const serializedByteLength = (value: unknown): number => {
  const serialized = JSON.stringify(value);
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(serialized).byteLength;
  }
  return serialized.length * 2;
};

export function pruneCalendarEventCache(
  cache: CalendarEventCacheSnapshot,
  limits: CalendarEventCacheLimits = calendarEventCacheLimits,
): CalendarEventCacheSnapshot {
  const entries = [...cache.entries].sort((left, right) =>
    right.lastAccessedAt.localeCompare(left.lastAccessedAt) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.key.localeCompare(right.key),
  );
  const fits = () => {
    const eventCount = entries.reduce((count, entry) => count + entry.events.length, 0);
    return (
      entries.length <= limits.maxEntries &&
      eventCount <= limits.maxEvents &&
      serializedByteLength({
        schemaVersion: CALENDAR_EVENT_CACHE_SCHEMA_VERSION,
        entries,
      }) <= limits.maxBytes
    );
  };
  while (entries.length > 0 && !fits()) entries.pop();
  return {
    schemaVersion: CALENDAR_EVENT_CACHE_SCHEMA_VERSION,
    entries,
  };
}

export function putCalendarEventCacheEntry(
  cache: CalendarEventCacheSnapshot,
  entry: CalendarEventCacheEntry,
  limits: CalendarEventCacheLimits = calendarEventCacheLimits,
): CalendarEventCacheSnapshot {
  return pruneCalendarEventCache({
    schemaVersion: CALENDAR_EVENT_CACHE_SCHEMA_VERSION,
    entries: [entry, ...cache.entries.filter(candidate => candidate.key !== entry.key)],
  }, limits);
}

export function touchCalendarEventCacheEntry(
  cache: CalendarEventCacheSnapshot,
  key: string,
  accessedAt: string,
): CalendarEventCacheSnapshot {
  const entry = findCalendarEventCacheEntry(cache, key);
  if (!entry || entry.lastAccessedAt === accessedAt) return cache;
  return putCalendarEventCacheEntry(cache, { ...entry, lastAccessedAt: accessedAt });
}

export function mergeCalendarEventCacheSnapshots(
  left: CalendarEventCacheSnapshot,
  right: CalendarEventCacheSnapshot,
): CalendarEventCacheSnapshot {
  const byKey = new Map<string, CalendarEventCacheEntry>();
  for (const entry of [...left.entries, ...right.entries]) {
    const current = byKey.get(entry.key);
    if (!current || entry.updatedAt > current.updatedAt) {
      byKey.set(entry.key, entry);
    } else if (entry.lastAccessedAt > current.lastAccessedAt) {
      byKey.set(entry.key, { ...current, lastAccessedAt: entry.lastAccessedAt });
    }
  }
  return pruneCalendarEventCache({
    schemaVersion: CALENDAR_EVENT_CACHE_SCHEMA_VERSION,
    entries: [...byKey.values()],
  });
}

export function removeCalendarFromEventCache(
  cache: CalendarEventCacheSnapshot,
  calendarId: string,
): CalendarEventCacheSnapshot {
  let next = createEmptyCalendarEventCache();
  for (const entry of cache.entries) {
    if (!entry.calendarIds.includes(calendarId)) {
      next = putCalendarEventCacheEntry(next, entry);
      continue;
    }
    const calendarIds = entry.calendarIds.filter(id => id !== calendarId);
    if (calendarIds.length === 0) continue;
    const request = createCalendarEventRangeRequest({
      timeMin: entry.timeMin,
      timeMax: entry.timeMax,
      calendarIds,
    });
    const calendarSyncedAt = Object.fromEntries(
      Object.entries(entry.calendarSyncedAt).filter(([id]) => id !== calendarId),
    );
    const candidate: CalendarEventCacheEntry = {
      ...entry,
      ...request,
      events: entry.events.filter(event => event.calendarId !== calendarId),
      calendarSyncedAt,
    };
    const existing = findCalendarEventCacheEntry(next, candidate.key);
    if (!existing || candidate.updatedAt > existing.updatedAt) {
      next = putCalendarEventCacheEntry(next, candidate);
    }
  }
  return next;
}

/**
 * Applies runtime removal tombstones to any snapshot received asynchronously.
 * This must wrap both network results and storage-conflict reconciliation so an
 * older writer cannot restore a calendar after the user removes it.
 */
export function applyCalendarRemovalTombstones(
  cache: CalendarEventCacheSnapshot,
  tombstones: CalendarRemovalTombstones,
): CalendarEventCacheSnapshot {
  return Object.keys(tombstones.removedAtGeneration).filter(
    calendarId => isCalendarRemovalTombstoned(tombstones, calendarId),
  ).reduce(
    (current, calendarId) => removeCalendarFromEventCache(current, calendarId),
    cache,
  );
}

export function applyCalendarRemovalTombstonesToRange(
  range: CalendarEventRangeRequest,
  tombstones: CalendarRemovalTombstones,
  requestGeneration?: number,
): CalendarEventRangeRequest | null {
  const calendarIds = range.calendarIds.filter(
    calendarId =>
      !isCalendarRemovalTombstoned(tombstones, calendarId) &&
      (requestGeneration === undefined || !calendarWasRemovedAfterGeneration(
        tombstones,
        calendarId,
        requestGeneration,
      )),
  );
  return calendarIds.length > 0
    ? createCalendarEventRangeRequest({
        timeMin: range.timeMin,
        timeMax: range.timeMax,
        calendarIds,
      })
    : null;
}

export function mergeCalendarEventQueryResult(
  request: CalendarEventRangeRequest,
  cached: CalendarEventCacheEntry | null,
  result: CalendarGatewayEventQueryResult,
  observedAt: string,
): CalendarEventCacheEntry {
  const requestedIds = new Set(request.calendarIds);
  const syncedIds = new Set(
    result.syncedCalendarIds.filter(calendarId => requestedIds.has(calendarId)),
  );
  const servedIds = new Set(
    (result.servedCalendarIds ?? result.syncedCalendarIds)
      .filter(calendarId => requestedIds.has(calendarId)),
  );
  const events = new Map<string, CalendarEvent>();
  for (const event of cached?.events ?? []) {
    if (!requestedIds.has(event.calendarId)) continue;
    if (!result.truncated && servedIds.has(event.calendarId)) continue;
    events.set(`${event.calendarId}\u001f${event.id}`, event);
  }
  for (const event of result.events) {
    // servedCalendarIds proves the response contains a complete D1/live slice.
    // Legacy gateways only exposed syncedCalendarIds, which remains the fallback.
    if (!requestedIds.has(event.calendarId) || !servedIds.has(event.calendarId)) continue;
    events.set(`${event.calendarId}\u001f${event.id}`, event);
  }

  const calendarSyncedAt: Record<string, string> = {};
  const cacheFreshness = new Map(
    (result.cache?.calendars ?? [])
      .filter(item => isIsoDateTime(item.lastSuccessAt))
      .map(item => [item.calendarId, item.lastSuccessAt as string]),
  );
  for (const calendarId of request.calendarIds) {
    const previous = cached?.calendarSyncedAt[calendarId];
    if (previous) calendarSyncedAt[calendarId] = previous;
    const lastSuccessAt = cacheFreshness.get(calendarId);
    if (lastSuccessAt) calendarSyncedAt[calendarId] = lastSuccessAt;
    if (syncedIds.has(calendarId)) calendarSyncedAt[calendarId] = observedAt;
  }
  const proofByCalendar = new Map(
    (result.cache?.calendars ?? []).map(proof => [proof.calendarId, proof]),
  );
  const allSlicesFresh = request.calendarIds.every(calendarId => {
    if (syncedIds.has(calendarId)) return true;
    const proof = proofByCalendar.get(calendarId);
    return Boolean(
      proof &&
      proof.freshness === "fresh" &&
      proof.lastSuccessAt &&
      proof.error === null,
    );
  });
  const completeSlice =
    !result.truncated &&
    result.errors.length === 0 &&
    servedIds.size === request.calendarIds.length &&
    allSlicesFresh;
  const fullySynced =
    !result.truncated &&
    result.errors.length === 0 &&
    syncedIds.size === request.calendarIds.length;

  return {
    ...request,
    events: [...events.values()].sort((left, right) =>
      left.start.localeCompare(right.start) || left.id.localeCompare(right.id),
    ),
    calendarSyncedAt,
    updatedAt: observedAt,
    lastFullSyncAt: fullySynced ? observedAt : cached?.lastFullSyncAt ?? null,
    lastAccessedAt: observedAt,
    partial: !completeSlice,
  };
}

export function calendarEventCacheEntryFreshness(
  entry: CalendarEventCacheEntry,
): string {
  const syncedTimes = entry.calendarIds
    .map(calendarId => entry.calendarSyncedAt[calendarId])
    .filter((value): value is string => Boolean(value))
    .sort();
  return syncedTimes[0] ?? entry.updatedAt;
}

/**
 * Coalesces callers by range. A queued background request upgrades to `wait`
 * before dispatch; an upgrade received after dispatch runs once the background
 * transport settles, never concurrently with it.
 */
export function runDedupedCalendarEventRequest<T>(
  inFlight: Map<string, CalendarEventInFlightRequest<T>>,
  key: string,
  requestedMode: CalendarEventRequestMode,
  load: (mode: CalendarEventRequestMode) => Promise<T>,
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    if (requestedMode === "wait") existing.requestedMode = "wait";
    return existing.promise;
  }
  const request: CalendarEventInFlightRequest<T> = {
    requestedMode,
    promise: Promise.resolve(undefined as T),
  };
  request.promise = Promise.resolve()
    .then(async () => {
      let completedMode: CalendarEventRequestMode | null = null;
      let result: T;
      while (completedMode !== request.requestedMode) {
        const activeMode: CalendarEventRequestMode = request.requestedMode;
        try {
          result = await load(activeMode);
        } catch (error) {
          if (activeMode === "background" && request.requestedMode === "wait") {
            completedMode = activeMode;
            continue;
          }
          throw error;
        }
        completedMode = activeMode;
      }
      return result!;
    })
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request.promise;
}
