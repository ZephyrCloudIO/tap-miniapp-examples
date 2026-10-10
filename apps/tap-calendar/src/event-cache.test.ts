import { describe, expect, it, rs } from "@rstest/core";
import type { CalendarEvent } from "./domain";
import {
  applyCalendarRemovalTombstones,
  applyCalendarRemovalTombstonesToRange,
  calendarWasRemovedAfterGeneration,
  calendarEventCacheEntryFreshness,
  calendarEventRangeKey,
  createCalendarEventRangeRequest,
  createEmptyCalendarEventCache,
  createCalendarRemovalTombstones,
  findReusableCalendarEventCacheEntry,
  isCalendarEventCacheSnapshot,
  mergeCalendarEventCacheSnapshots,
  mergeCalendarEventQueryResult,
  pruneCalendarEventCache,
  putCalendarEventCacheEntry,
  removeCalendarFromEventCache,
  restoreRemovedCalendar,
  runDedupedCalendarEventRequest,
  tombstoneRemovedCalendar,
  type CalendarEventCacheEntry,
  type CalendarEventInFlightRequest,
} from "./event-cache";
import {
  CALENDAR_EVENT_PARTIAL_RETRY_MS,
  CALENDAR_EVENT_REFRESH_INTERVAL_MS,
  needsCatchUp,
  syncStateForEntry,
} from "./use-calendar-event-cache";

const timeMin = "2026-08-09T00:00:00.000Z";
const timeMax = "2026-08-17T00:00:00.000Z";

const event = (
  id: string,
  calendarId: string,
  start = "2026-08-12T14:00:00.000Z",
): CalendarEvent => ({
  id,
  calendarId,
  title: id,
  start,
  end: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
  kind: "meeting",
  status: "confirmed",
  location: null,
  attendees: [],
});

const entry = (
  id: string,
  accessedAt: string,
  events: readonly CalendarEvent[] = [event(`event-${id}`, `calendar-${id}`)],
): CalendarEventCacheEntry => {
  const request = createCalendarEventRangeRequest({
    timeMin,
    timeMax,
    calendarIds: events.map(item => item.calendarId),
  });
  return {
    ...request,
    events,
    calendarSyncedAt: Object.fromEntries(
      request.calendarIds.map(calendarId => [calendarId, accessedAt]),
    ),
    updatedAt: accessedAt,
    lastFullSyncAt: accessedAt,
    lastAccessedAt: accessedAt,
    partial: false,
  };
};

describe("calendar event range cache", () => {
  it("normalizes the key across calendar ordering and duplicate IDs", () => {
    const left = calendarEventRangeKey({
      timeMin,
      timeMax,
      calendarIds: ["calendar-b", "calendar-a", "calendar-a"],
    });
    const right = calendarEventRangeKey({
      timeMin,
      timeMax,
      calendarIds: ["calendar-a", "calendar-b"],
    });

    expect(left).toBe(right);
    expect(createCalendarEventRangeRequest({
      timeMin,
      timeMax,
      calendarIds: ["calendar-b", "calendar-a"],
    }).calendarIds).toEqual(["calendar-a", "calendar-b"]);
  });

  it("replaces only successfully synced calendars in a partial result", () => {
    const request = createCalendarEventRangeRequest({
      timeMin,
      timeMax,
      calendarIds: ["calendar-a", "calendar-b"],
    });
    const cached: CalendarEventCacheEntry = {
      ...request,
      events: [event("old-a", "calendar-a"), event("old-b", "calendar-b")],
      calendarSyncedAt: {
        "calendar-a": "2026-08-15T10:00:00.000Z",
        "calendar-b": "2026-08-15T09:00:00.000Z",
      },
      updatedAt: "2026-08-15T10:00:00.000Z",
      lastFullSyncAt: "2026-08-15T10:00:00.000Z",
      lastAccessedAt: "2026-08-15T10:00:00.000Z",
      partial: false,
    };

    const merged = mergeCalendarEventQueryResult(request, cached, {
      timeMin,
      timeMax,
      syncedAt: "2026-08-15T10:05:00.000Z",
      events: [event("new-a", "calendar-a"), event("ignored-b", "calendar-b")],
      syncedCalendarIds: ["calendar-a"],
      errors: [{ calendarId: "calendar-b", code: "offline", message: "offline" }],
      truncated: false,
    }, "2026-08-15T10:05:00.000Z");

    expect(merged.events.map(item => item.id)).toEqual(["new-a", "old-b"]);
    expect(merged.partial).toBe(true);
    expect(merged.calendarSyncedAt).toEqual({
      "calendar-a": "2026-08-15T10:05:00.000Z",
      "calendar-b": "2026-08-15T09:00:00.000Z",
    });
    // The failure is reported by name; it must not make the healthy calendar look stale.
    expect(merged.failedCalendarIds).toEqual(["calendar-b"]);
    expect(calendarEventCacheEntryFreshness(merged)).toBe("2026-08-15T10:05:00.000Z");
    expect(syncStateForEntry(merged)).toMatchObject({ status: "partial", failedCalendarIds: ["calendar-b"] });
    const projected = findReusableCalendarEventCacheEntry(
      putCalendarEventCacheEntry(createEmptyCalendarEventCache(), merged),
      createCalendarEventRangeRequest({ timeMin, timeMax, calendarIds: ["calendar-a"] }),
    );
    expect(projected?.failedCalendarIds).toBeUndefined();
    expect(isCalendarEventCacheSnapshot({ schemaVersion: 1, entries: [merged] })).toBe(true);
  });

  it("reports stale-but-healthy slices as cached, not as failed calendars", () => {
    const request = createCalendarEventRangeRequest({ timeMin, timeMax, calendarIds: ["calendar-a"] });
    const merged = mergeCalendarEventQueryResult(request, null, {
      timeMin,
      timeMax,
      syncedAt: "2026-08-15T10:05:00.000Z",
      events: [event("a", "calendar-a")],
      syncedCalendarIds: [],
      servedCalendarIds: ["calendar-a"],
      errors: [],
      truncated: false,
      cache: { servedAt: "2026-08-15T10:05:00.000Z", calendars: [{
        calendarId: "calendar-a", cacheRevision: 3, freshness: "stale",
        lastSuccessAt: "2026-08-15T10:00:00.000Z", nextSyncAt: "2026-08-15T10:05:00.000Z", error: null,
      }] },
    }, "2026-08-15T10:05:00.000Z");
    expect(merged.partial).toBe(true);
    expect(syncStateForEntry(merged)).toMatchObject({ status: "ready", failedCalendarIds: [] });
  });

  it("uses complete D1-served slices without pretending they freshly synced", () => {
    const request = createCalendarEventRangeRequest({
      timeMin,
      timeMax,
      calendarIds: ["calendar-a", "calendar-b"],
    });
    const cached: CalendarEventCacheEntry = {
      ...entry("a", "2026-08-15T10:00:00.000Z", [
        event("old-a", "calendar-a"),
        event("old-b", "calendar-b"),
      ]),
      ...request,
      calendarSyncedAt: {
        "calendar-a": "2026-08-15T10:00:00.000Z",
        "calendar-b": "2026-08-15T09:00:00.000Z",
      },
    };
    const result = {
      timeMin,
      timeMax,
      syncedAt: "2026-08-15T10:05:00.000Z",
      events: [
        event("new-a", "calendar-a"),
        event("d1-b", "calendar-b"),
      ],
      servedCalendarIds: ["calendar-a", "calendar-b"],
      syncedCalendarIds: ["calendar-a"],
      cache: {
        servedAt: "2026-08-15T10:05:00.000Z",
        calendars: [{
          calendarId: "calendar-b",
          cacheRevision: 4,
          freshness: "stale" as const,
          lastSuccessAt: "2026-08-15T09:30:00.000Z",
          nextSyncAt: "2026-08-15T10:10:00.000Z",
          error: null,
        }],
      },
      errors: [],
      truncated: false,
    };

    const merged = mergeCalendarEventQueryResult(
      request,
      cached,
      result,
      "2026-08-15T10:05:00.000Z",
    );

    expect(merged.events.map(item => item.id)).toEqual(["d1-b", "new-a"]);
    expect(merged.calendarSyncedAt).toEqual({
      "calendar-a": "2026-08-15T10:05:00.000Z",
      "calendar-b": "2026-08-15T09:30:00.000Z",
    });
    expect(merged.partial).toBe(true);
  });

  it("does not discard cached events when a gateway result is truncated", () => {
    const request = createCalendarEventRangeRequest({
      timeMin,
      timeMax,
      calendarIds: ["calendar-a"],
    });
    const cached = entry(
      "a",
      "2026-08-15T10:00:00.000Z",
      [event("old-a", "calendar-a")],
    );
    const merged = mergeCalendarEventQueryResult(request, cached, {
      timeMin,
      timeMax,
      syncedAt: "2026-08-15T10:05:00.000Z",
      events: [event("new-a", "calendar-a", "2026-08-12T15:00:00.000Z")],
      syncedCalendarIds: ["calendar-a"],
      errors: [],
      truncated: true,
    }, "2026-08-15T10:05:00.000Z");

    expect(merged.events.map(item => item.id)).toEqual(["old-a", "new-a"]);
    expect(merged.partial).toBe(true);
  });

  it("evicts least-recently-used ranges against range and event ceilings", () => {
    const first = entry("first", "2026-08-15T08:00:00.000Z");
    const second = entry("second", "2026-08-15T09:00:00.000Z");
    const third = entry("third", "2026-08-15T10:00:00.000Z");
    const cache = [first, second, third].reduce(
      (current, candidate) => putCalendarEventCacheEntry(current, candidate, {
        maxEntries: 2,
        maxEvents: 2,
        maxBytes: 100_000,
      }),
      createEmptyCalendarEventCache(),
    );

    expect(cache.entries.map(candidate => candidate.key)).toEqual([
      third.key,
      second.key,
    ]);
    expect(pruneCalendarEventCache(cache, {
      maxEntries: 10,
      maxEvents: 1,
      maxBytes: 100_000,
    }).entries).toHaveLength(1);
  });

  it("never evicts the most recently viewed range, even when it alone exceeds the budget", () => {
    const older = entry("older", "2026-08-15T08:00:00.000Z");
    const prefetched = entry("prefetched", "1970-01-01T00:00:00.000Z");
    const large = entry("large", "2026-08-15T10:00:00.000Z", Array.from({ length: 40 }, (_, index) =>
      ({ ...event(`large-${index}`, "calendar-large"), description: "x".repeat(2_000) })));
    const limits = { maxEntries: 10, maxEvents: 4_000, maxBytes: 20_000 };
    const cache = [older, prefetched, large].reduce(
      (current, candidate) => putCalendarEventCacheEntry(current, candidate, limits),
      createEmptyCalendarEventCache(),
    );
    expect(cache.entries.map(candidate => candidate.key)).toEqual([large.key]);
    expect(mergeCalendarEventCacheSnapshots(cache, createEmptyCalendarEventCache()).entries)
      .toHaveLength(1);
  });

  it("evicts prefetched neighbors before viewed ranges", () => {
    const viewed = entry("viewed", "2026-08-15T09:00:00.000Z");
    const prefetched = entry("prefetched", "1970-01-01T00:00:00.000Z");
    const cache = pruneCalendarEventCache({ schemaVersion: 1, entries: [prefetched, viewed] }, {
      maxEntries: 1, maxEvents: 4_000, maxBytes: 100_000,
    });
    expect(cache.entries.map(candidate => candidate.key)).toEqual([viewed.key]);
  });

  it("purges a removed calendar while preserving other cached slices", () => {
    const source = entry("mixed", "2026-08-15T10:00:00.000Z", [
      event("event-a", "calendar-a"),
      event("event-b", "calendar-b"),
    ]);
    const cache = putCalendarEventCacheEntry(createEmptyCalendarEventCache(), source);

    const removed = removeCalendarFromEventCache(cache, "calendar-a");

    expect(removed.entries).toHaveLength(1);
    expect(removed.entries[0]?.calendarIds).toEqual(["calendar-b"]);
    expect(removed.entries[0]?.events.map(item => item.id)).toEqual(["event-b"]);
    expect(removed.entries[0]?.key).toBe(calendarEventRangeKey({
      timeMin,
      timeMax,
      calendarIds: ["calendar-b"],
    }));
  });

  it("reuses the narrowest calendar-ID superset without exposing hidden data", () => {
    const narrowSuperset = entry("narrow", "2026-08-15T09:00:00.000Z", [
      event("visible-a", "calendar-a"),
      event("hidden-b", "calendar-b"),
    ]);
    const wideSuperset = entry("wide", "2026-08-15T10:00:00.000Z", [
      event("wide-a", "calendar-a"),
      event("wide-b", "calendar-b"),
      event("wide-c", "calendar-c"),
    ]);
    const cache = [wideSuperset, narrowSuperset].reduce(
      (current, candidate) => putCalendarEventCacheEntry(current, candidate),
      createEmptyCalendarEventCache(),
    );
    const request = createCalendarEventRangeRequest({
      timeMin,
      timeMax,
      calendarIds: ["calendar-a"],
    });

    const projected = findReusableCalendarEventCacheEntry(cache, request);

    expect(projected).toMatchObject({
      key: request.key,
      calendarIds: ["calendar-a"],
      events: [{ id: "visible-a", calendarId: "calendar-a" }],
      calendarSyncedAt: {
        "calendar-a": "2026-08-15T09:00:00.000Z",
      },
    });
    expect(Object.keys(projected?.calendarSyncedAt ?? {})).toEqual(["calendar-a"]);
    expect(projected?.events.every(item => item.calendarId === "calendar-a")).toBe(true);
  });

  it("does not reuse a calendar-ID superset from a different time window", () => {
    const cache = putCalendarEventCacheEntry(
      createEmptyCalendarEventCache(),
      entry("wide", "2026-08-15T10:00:00.000Z", [
        event("event-a", "calendar-a"),
        event("event-b", "calendar-b"),
      ]),
    );
    const request = createCalendarEventRangeRequest({
      timeMin: "2026-08-17T00:00:00.000Z",
      timeMax: "2026-08-25T00:00:00.000Z",
      calendarIds: ["calendar-a"],
    });

    expect(findReusableCalendarEventCacheEntry(cache, request)).toBeNull();
  });

  it("uses a monotonic tombstone to reject a range that resolves after removal", () => {
    const request = createCalendarEventRangeRequest({
      timeMin,
      timeMax,
      calendarIds: ["calendar-a", "calendar-b"],
    });
    const requestGeneration = createCalendarRemovalTombstones().generation;
    const tombstones = tombstoneRemovedCalendar(
      createCalendarRemovalTombstones(),
      "calendar-a",
    );
    const lateEntry = mergeCalendarEventQueryResult(request, null, {
      timeMin,
      timeMax,
      syncedAt: "2026-08-15T10:05:00.000Z",
      events: [event("late-a", "calendar-a"), event("late-b", "calendar-b")],
      servedCalendarIds: ["calendar-a", "calendar-b"],
      syncedCalendarIds: ["calendar-a", "calendar-b"],
      errors: [],
      truncated: false,
    }, "2026-08-15T10:05:00.000Z");

    const reconciled = applyCalendarRemovalTombstones(
      putCalendarEventCacheEntry(createEmptyCalendarEventCache(), lateEntry),
      tombstones,
    );

    expect(calendarWasRemovedAfterGeneration(
      tombstones,
      "calendar-a",
      requestGeneration,
    )).toBe(true);
    expect(tombstones.generation).toBeGreaterThan(requestGeneration);
    expect(reconciled.entries).toHaveLength(1);
    expect(reconciled.entries[0]?.calendarIds).toEqual(["calendar-b"]);
    expect(reconciled.entries[0]?.events.map(item => item.id)).toEqual(["late-b"]);
  });

  it("keeps a removal tombstone authoritative during storage conflict reconciliation", () => {
    const staleStoredEntry = entry("mixed", "2026-08-15T10:00:00.000Z", [
      event("stored-a", "calendar-a"),
      event("stored-b", "calendar-b"),
    ]);
    const stored = putCalendarEventCacheEntry(
      createEmptyCalendarEventCache(),
      staleStoredEntry,
    );
    const tombstones = tombstoneRemovedCalendar(
      createCalendarRemovalTombstones(),
      "calendar-a",
    );
    const local = applyCalendarRemovalTombstones(stored, tombstones);

    const reconciled = applyCalendarRemovalTombstones(
      mergeCalendarEventCacheSnapshots(stored, local),
      tombstones,
    );

    expect(reconciled.entries.every(candidate =>
      !candidate.calendarIds.includes("calendar-a") &&
      candidate.events.every(item => item.calendarId !== "calendar-a")
    )).toBe(true);
    expect(reconciled.entries.flatMap(candidate => candidate.events).map(item => item.id))
      .toEqual(["stored-b"]);
  });

  it("restores a re-added calendar without admitting its pre-removal request", () => {
    const request = createCalendarEventRangeRequest({
      timeMin,
      timeMax,
      calendarIds: ["calendar-a", "calendar-b"],
    });
    const requestGeneration = createCalendarRemovalTombstones().generation;
    const removed = tombstoneRemovedCalendar(
      createCalendarRemovalTombstones(),
      "calendar-a",
    );
    const restored = restoreRemovedCalendar(removed, "calendar-a");

    expect(applyCalendarRemovalTombstonesToRange(
      request,
      restored,
      requestGeneration,
    )?.calendarIds).toEqual(["calendar-b"]);
    expect(applyCalendarRemovalTombstonesToRange(
      request,
      restored,
      restored.generation,
    )?.calendarIds).toEqual(["calendar-a", "calendar-b"]);
    expect(applyCalendarRemovalTombstones(
      putCalendarEventCacheEntry(
        createEmptyCalendarEventCache(),
        entry("restored", "2026-08-15T10:10:00.000Z", [
          event("restored-a", "calendar-a"),
        ]),
      ),
      restored,
    ).entries[0]?.events.map(item => item.id)).toEqual(["restored-a"]);
  });

  it("merges queued and externally stored ranges before a revision retry", () => {
    const local = putCalendarEventCacheEntry(
      createEmptyCalendarEventCache(),
      entry("local", "2026-08-15T10:00:00.000Z"),
    );
    const external = putCalendarEventCacheEntry(
      createEmptyCalendarEventCache(),
      entry("external", "2026-08-15T09:00:00.000Z"),
    );

    const merged = mergeCalendarEventCacheSnapshots(local, external);

    expect(merged.entries.map(item => item.events[0]?.id)).toEqual([
      "event-local",
      "event-external",
    ]);
  });

  it("rejects snapshots with another schema version", () => {
    expect(isCalendarEventCacheSnapshot({ schemaVersion: 2, entries: [] })).toBe(false);
  });

  it("deduplicates in-flight requests and releases the key afterward", async () => {
    const requests = new Map<string, CalendarEventInFlightRequest<string>>();
    const load = rs.fn(async () => "events");

    const first = runDedupedCalendarEventRequest(requests, "range", "wait", load);
    const second = runDedupedCalendarEventRequest(requests, "range", "wait", load);

    expect(second).toBe(first);
    await expect(first).resolves.toBe("events");
    expect(load).toHaveBeenCalledTimes(1);
    await expect(runDedupedCalendarEventRequest(
      requests,
      "range",
      "wait",
      load,
    )).resolves.toBe("events");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("escalates a queued background request to one wait transport", async () => {
    const requests = new Map<string, CalendarEventInFlightRequest<string>>();
    const modes: string[] = [];
    const load = rs.fn(async mode => {
      modes.push(mode);
      return mode;
    });

    const background = runDedupedCalendarEventRequest(
      requests,
      "range",
      "background",
      load,
    );
    const foreground = runDedupedCalendarEventRequest(
      requests,
      "range",
      "wait",
      load,
    );

    expect(foreground).toBe(background);
    await expect(foreground).resolves.toBe("wait");
    expect(modes).toEqual(["wait"]);
  });

  it("serializes a late wait escalation behind an active background transport", async () => {
    const requests = new Map<string, CalendarEventInFlightRequest<string>>();
    let releaseBackground!: () => void;
    const backgroundGate = new Promise<void>(resolve => {
      releaseBackground = resolve;
    });
    const modes: string[] = [];
    let activeTransports = 0;
    let maxActiveTransports = 0;
    const load = rs.fn(async mode => {
      modes.push(mode);
      activeTransports += 1;
      maxActiveTransports = Math.max(maxActiveTransports, activeTransports);
      if (mode === "background") await backgroundGate;
      activeTransports -= 1;
      return mode;
    });

    const background = runDedupedCalendarEventRequest(
      requests,
      "range",
      "background",
      load,
    );
    await Promise.resolve();
    expect(modes).toEqual(["background"]);
    const foreground = runDedupedCalendarEventRequest(
      requests,
      "range",
      "wait",
      load,
    );

    expect(foreground).toBe(background);
    releaseBackground();
    await expect(foreground).resolves.toBe("wait");
    expect(modes).toEqual(["background", "wait"]);
    expect(maxActiveTransports).toBe(1);
  });

  it("does not let a cleared old request remove its replacement", async () => {
    const requests = new Map<string, CalendarEventInFlightRequest<string>>();
    let releaseOld!: () => void;
    let releaseReplacement!: () => void;
    const oldGate = new Promise<void>(resolve => {
      releaseOld = resolve;
    });
    const replacementGate = new Promise<void>(resolve => {
      releaseReplacement = resolve;
    });
    const old = runDedupedCalendarEventRequest(
      requests,
      "range",
      "background",
      async () => {
        await oldGate;
        return "old";
      },
    );
    await Promise.resolve();
    requests.clear();
    const replacement = runDedupedCalendarEventRequest(
      requests,
      "range",
      "wait",
      async () => {
        await replacementGate;
        return "replacement";
      },
    );
    await Promise.resolve();

    expect(requests.get("range")?.promise).toBe(replacement);
    releaseOld();
    await expect(old).resolves.toBe("old");
    expect(requests.get("range")?.promise).toBe(replacement);
    releaseReplacement();
    await expect(replacement).resolves.toBe("replacement");
    expect(requests.has("range")).toBe(false);
  });

  it("throttles catch-up by the last gateway request, not by a failing calendar's age", () => {
    const updatedAt = "2026-08-15T10:00:00.000Z";
    const partial = { ...entry("p", "2026-08-06T10:00:00.000Z"), updatedAt, partial: true, failedCalendarIds: ["calendar-p"] };
    const complete = { ...entry("c", updatedAt), updatedAt };
    const at = (ms: number) => Date.parse(updatedAt) + ms;
    expect(needsCatchUp(partial, at(5_000))).toBe(false);
    expect(needsCatchUp(partial, at(CALENDAR_EVENT_PARTIAL_RETRY_MS))).toBe(true);
    expect(needsCatchUp(complete, at(CALENDAR_EVENT_PARTIAL_RETRY_MS))).toBe(false);
    expect(needsCatchUp(complete, at(CALENDAR_EVENT_REFRESH_INTERVAL_MS))).toBe(true);
    expect(needsCatchUp(null)).toBe(true);
  });
});
