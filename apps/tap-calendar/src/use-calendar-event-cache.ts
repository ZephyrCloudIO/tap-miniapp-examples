import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shiftCalendarAnchor } from "./calendar-navigation";
import type { CalendarEvent, CalendarView } from "./domain";
import {
  applyCalendarRemovalTombstones,
  applyCalendarRemovalTombstonesToRange,
  calendarWasRemovedAfterGeneration,
  calendarEventCacheEntryFreshness,
  createCalendarRemovalTombstones,
  createCalendarEventRangeRequest,
  createEmptyCalendarEventCache,
  findReusableCalendarEventCacheEntry,
  mergeCalendarEventCacheSnapshots,
  mergeCalendarEventQueryResult,
  putCalendarEventCacheEntry,
  removeCalendarFromEventCache,
  restoreRemovedCalendar,
  runDedupedCalendarEventRequest,
  tombstoneRemovedCalendar,
  type CalendarEventCacheEntry,
  type CalendarEventCacheSnapshot,
  type CalendarEventInFlightRequest,
  type CalendarEventRangeRequest,
} from "./event-cache";
import {
  loadCalendarEventCache,
  saveCalendarEventCache,
} from "./event-cache-storage";
import {
  calendarGatewayEventWindow,
  type CalendarGatewayClient,
} from "./gateway";

export const CALENDAR_EVENT_REFRESH_INTERVAL_MS = 5 * 60_000;
const CALENDAR_EVENT_PREFETCH_ACCESS_TIME = "1970-01-01T00:00:00.000Z";

export interface ProviderEventSyncState {
  readonly status: "idle" | "syncing" | "ready" | "partial" | "error";
  readonly syncedAt: string | null;
  readonly eventCount: number;
}

export interface CalendarEventCacheResult {
  readonly events: readonly CalendarEvent[];
  /** True only when every requested calendar has a cached slice for this exact range. */
  readonly hasCompleteCoverage: boolean;
  readonly syncState: ProviderEventSyncState;
  readonly refresh: () => void;
  readonly removeCalendar: (calendarId: string) => void;
}

const canRefreshInForeground = (): boolean =>
  (typeof document === "undefined" || document.visibilityState === "visible") &&
  (typeof navigator === "undefined" || navigator.onLine !== false);

const rangeFromView = (
  view: CalendarView,
  anchorDate: string,
  calendarIds: readonly string[],
): CalendarEventRangeRequest => createCalendarEventRangeRequest({
  ...calendarGatewayEventWindow(view, anchorDate),
  calendarIds,
});

const syncStateForEntry = (
  entry: CalendarEventCacheEntry | null,
): ProviderEventSyncState => entry
  ? {
      status: entry.partial ? "partial" : "ready",
      syncedAt: calendarEventCacheEntryFreshness(entry),
      eventCount: entry.events.length,
    }
  : { status: "idle", syncedAt: null, eventCount: 0 };

const needsCatchUp = (
  entry: CalendarEventCacheEntry | null,
  now = Date.now(),
): boolean => {
  if (!entry || entry.partial) return true;
  return now - Date.parse(calendarEventCacheEntryFreshness(entry)) >=
    CALENDAR_EVENT_REFRESH_INTERVAL_MS;
};

export function useCalendarEventCache(input: {
  readonly preview: boolean;
  readonly principalId: string;
  readonly gateway: CalendarGatewayClient;
  readonly calendarIds: readonly string[];
  readonly view: CalendarView;
  readonly anchorDate: string;
}): CalendarEventCacheResult {
  const calendarSignature = useMemo(
    () => [...new Set(input.calendarIds)].sort().join("\u001f"),
    [input.calendarIds],
  );
  const normalizedCalendarIds = useMemo(
    () => calendarSignature ? calendarSignature.split("\u001f") : [],
    [calendarSignature],
  );
  const currentRange = useMemo(
    () => normalizedCalendarIds.length > 0
      ? rangeFromView(input.view, input.anchorDate, normalizedCalendarIds)
      : null,
    [calendarSignature, input.anchorDate, input.view],
  );
  const adjacentRanges = useMemo<readonly CalendarEventRangeRequest[]>(() => {
    if (!currentRange) return [];
    return ([-1, 1] as const).map(direction => rangeFromView(
      input.view,
      shiftCalendarAnchor(input.view, input.anchorDate, direction),
      normalizedCalendarIds,
    ));
  }, [calendarSignature, currentRange?.key, input.anchorDate, input.view]);

  const cacheRef = useRef<CalendarEventCacheSnapshot>(createEmptyCalendarEventCache());
  const cacheRevisionRef = useRef<number | null>(null);
  const pendingWriteRef = useRef<CalendarEventCacheSnapshot | null>(null);
  const writeRunningRef = useRef(false);
  const inFlightRef = useRef(new Map<
    string,
    CalendarEventInFlightRequest<CalendarEventCacheEntry | null>
  >());
  const removalTombstonesRef = useRef(createCalendarRemovalTombstones());
  const currentRangeKeyRef = useRef<string | null>(currentRange?.key ?? null);
  const activeRangesRef = useRef({ current: currentRange, adjacent: adjacentRanges });
  const mountedRef = useRef(true);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [cacheEpoch, setCacheEpoch] = useState(0);
  const [syncState, setSyncState] = useState<ProviderEventSyncState>(
    syncStateForEntry(null),
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const persistBestEffort = useCallback((cache: CalendarEventCacheSnapshot) => {
    pendingWriteRef.current = cache;
    if (writeRunningRef.current) return;
    writeRunningRef.current = true;
    void (async () => {
      while (pendingWriteRef.current) {
        let candidate = applyCalendarRemovalTombstones(
          mergeCalendarEventCacheSnapshots(
            pendingWriteRef.current,
            cacheRef.current,
          ),
          removalTombstonesRef.current,
        );
        pendingWriteRef.current = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            cacheRevisionRef.current = await saveCalendarEventCache(
              candidate,
              input.preview,
              cacheRevisionRef.current,
              input.principalId,
            );
            break;
          } catch {
            if (attempt > 0) break;
            try {
              const stored = await loadCalendarEventCache(
                input.preview,
                input.principalId,
              );
              cacheRevisionRef.current = stored.revision;
              candidate = applyCalendarRemovalTombstones(
                mergeCalendarEventCacheSnapshots(
                  stored.cache,
                  cacheRef.current,
                ),
                removalTombstonesRef.current,
              );
              cacheRef.current = candidate;
              if (mountedRef.current) setCacheEpoch(epoch => epoch + 1);
            } catch {
              break;
            }
          }
        }
      }
    })().finally(() => {
      writeRunningRef.current = false;
    });
  }, [input.preview, input.principalId]);

  useEffect(() => {
    let cancelled = false;
    void loadCalendarEventCache(input.preview, input.principalId)
      .then(loaded => {
        if (cancelled) return;
        cacheRevisionRef.current = loaded.revision;
        cacheRef.current = applyCalendarRemovalTombstones(
          mergeCalendarEventCacheSnapshots(
            loaded.cache,
            cacheRef.current,
          ),
          removalTombstonesRef.current,
        );
        setCacheEpoch(epoch => epoch + 1);
      })
      .catch(() => {
        // Event caching is an optimization; a storage failure never blocks Calendar.
      })
      .finally(() => {
        if (!cancelled) setCacheLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [input.preview, input.principalId]);

  useEffect(() => {
    currentRangeKeyRef.current = currentRange?.key ?? null;
    activeRangesRef.current = { current: currentRange, adjacent: adjacentRanges };
  }, [adjacentRanges, currentRange]);

  useEffect(() => {
    const previous = removalTombstonesRef.current;
    let restored = previous;
    for (const calendarId of normalizedCalendarIds) {
      restored = restoreRemovedCalendar(restored, calendarId);
    }
    removalTombstonesRef.current = restored;
    if (restored.generation !== previous.generation) {
      inFlightRef.current.clear();
    }
  }, [calendarSignature]);

  const updateCache = useCallback((cache: CalendarEventCacheSnapshot) => {
    const reconciled = applyCalendarRemovalTombstones(
      cache,
      removalTombstonesRef.current,
    );
    cacheRef.current = reconciled;
    if (mountedRef.current) setCacheEpoch(epoch => epoch + 1);
    persistBestEffort(reconciled);
  }, [persistBestEffort]);

  const revalidateRange = useCallback(async (
    range: CalendarEventRangeRequest,
    revalidate: "wait" | "background",
  ) => {
    const foreground = range.key === currentRangeKeyRef.current;
    if (foreground && revalidate === "wait") {
      const cached = findReusableCalendarEventCacheEntry(cacheRef.current, range);
      setSyncState({
        status: "syncing",
        syncedAt: cached ? calendarEventCacheEntryFreshness(cached) : null,
        eventCount: cached?.events.length ?? 0,
      });
    }
    try {
      const entry = await runDedupedCalendarEventRequest(
        inFlightRef.current,
        range.key,
        revalidate,
        async activeMode => {
          const removalGeneration = removalTombstonesRef.current.generation;
          const queryRange = applyCalendarRemovalTombstonesToRange(
            range,
            removalTombstonesRef.current,
          );
          if (!queryRange) return null;
          const requestStartedAt = new Date().toISOString();
          const query = {
            timeMin: queryRange.timeMin,
            timeMax: queryRange.timeMax,
            calendarIds: queryRange.calendarIds,
            revalidate: activeMode,
          };
          const result = await input.gateway.queryEvents(query);
          const currentTombstones = removalTombstonesRef.current;
          const mergeRange = applyCalendarRemovalTombstonesToRange(
            range,
            currentTombstones,
            removalGeneration,
          );
          if (!mergeRange) return null;
          const activeCalendarIds = new Set(mergeRange.calendarIds);
          const activeResult = {
            ...result,
            events: result.events.filter(event => activeCalendarIds.has(event.calendarId)),
            syncedCalendarIds: result.syncedCalendarIds.filter(calendarId =>
              activeCalendarIds.has(calendarId)
            ),
            ...(result.servedCalendarIds
              ? { servedCalendarIds: result.servedCalendarIds.filter(calendarId =>
                  activeCalendarIds.has(calendarId)
                ) }
              : {}),
            errors: result.errors.filter(error => activeCalendarIds.has(error.calendarId)),
            ...(result.cache
              ? {
                  cache: {
                    ...result.cache,
                    calendars: result.cache.calendars.filter(calendar =>
                      activeCalendarIds.has(calendar.calendarId)
                    ),
                  },
                }
              : {}),
          };
          const cached = findReusableCalendarEventCacheEntry(
            cacheRef.current,
            mergeRange,
          );
          if (
            activeMode === "background" &&
            cached &&
            cached.updatedAt > requestStartedAt
          ) {
            return cached;
          }
          const mergedResult = mergeCalendarEventQueryResult(
            mergeRange,
            cached,
            activeResult,
            new Date().toISOString(),
          );
          const merged = activeMode === "background"
            ? {
                ...mergedResult,
                lastAccessedAt: cached?.lastAccessedAt ??
                  CALENDAR_EVENT_PREFETCH_ACCESS_TIME,
              }
            : mergedResult;
          const reconciled = applyCalendarRemovalTombstones(
            putCalendarEventCacheEntry(cacheRef.current, merged),
            currentTombstones,
          );
          updateCache(reconciled);
          return findReusableCalendarEventCacheEntry(reconciled, mergeRange);
        },
      );
      if (entry && range.key === currentRangeKeyRef.current && mountedRef.current) {
        setSyncState(syncStateForEntry(entry));
      }
    } catch {
      if (range.key !== currentRangeKeyRef.current || !mountedRef.current) return;
      const cached = findReusableCalendarEventCacheEntry(cacheRef.current, range);
      setSyncState({
        status: "error",
        syncedAt: cached ? calendarEventCacheEntryFreshness(cached) : null,
        eventCount: cached?.events.length ?? 0,
      });
    }
  }, [input.gateway, updateCache]);

  const refreshRangeSet = useCallback((onlyWhenDue: boolean) => {
    if (!cacheLoaded || !canRefreshInForeground()) return;
    const ranges = activeRangesRef.current;
    if (!ranges.current) return;
    const cached = findReusableCalendarEventCacheEntry(
      cacheRef.current,
      ranges.current,
    );
    if (onlyWhenDue && !needsCatchUp(cached)) return;
    void Promise.all([
      revalidateRange(ranges.current, "wait"),
      ...ranges.adjacent.map(range =>
        revalidateRange(range, "background"),
      ),
    ]);
  }, [cacheLoaded, revalidateRange]);

  useEffect(() => {
    if (!cacheLoaded || !currentRange) {
      setSyncState(syncStateForEntry(null));
      return;
    }
    const cached = findReusableCalendarEventCacheEntry(cacheRef.current, currentRange);
    setSyncState(syncStateForEntry(cached));
    if (!canRefreshInForeground()) return;
    void Promise.all([
      revalidateRange(currentRange, "wait"),
      ...adjacentRanges.map(range =>
        revalidateRange(range, "background"),
      ),
    ]);
  }, [cacheLoaded, currentRange?.key, revalidateRange]);

  useEffect(() => {
    if (!cacheLoaded || !currentRange) return;
    const cached = findReusableCalendarEventCacheEntry(
      cacheRef.current,
      currentRange,
    );
    if (!cached) return;
    const accessedAt = new Date().toISOString();
    if (cached.lastAccessedAt === accessedAt) return;
    updateCache(putCalendarEventCacheEntry(cacheRef.current, {
      ...cached,
      lastAccessedAt: accessedAt,
    }));
  }, [cacheLoaded, currentRange?.key, updateCache]);

  useEffect(() => {
    const interval = globalThis.setInterval(
      () => refreshRangeSet(false),
      CALENDAR_EVENT_REFRESH_INTERVAL_MS,
    );
    const catchUp = () => refreshRangeSet(true);
    const refreshOnline = () => refreshRangeSet(false);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") catchUp();
    };
    globalThis.addEventListener("focus", catchUp);
    globalThis.addEventListener("online", refreshOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      globalThis.clearInterval(interval);
      globalThis.removeEventListener("focus", catchUp);
      globalThis.removeEventListener("online", refreshOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshRangeSet]);

  const currentEntry = currentRange
    ? findReusableCalendarEventCacheEntry(cacheRef.current, currentRange)
    : null;
  void cacheEpoch;

  return {
    events: currentEntry?.events ?? [],
    hasCompleteCoverage: currentEntry !== null && !currentEntry.partial,
    syncState,
    refresh: () => refreshRangeSet(false),
    removeCalendar: calendarId => {
      const previousGeneration = removalTombstonesRef.current.generation;
      removalTombstonesRef.current = tombstoneRemovedCalendar(
        removalTombstonesRef.current,
        calendarId,
      );
      inFlightRef.current.clear();
      // The generation check documents the in-flight boundary: every request
      // started at or before this value must exclude this calendar on resolve.
      if (!calendarWasRemovedAfterGeneration(
        removalTombstonesRef.current,
        calendarId,
        previousGeneration,
      )) return;
      updateCache(removeCalendarFromEventCache(cacheRef.current, calendarId));
    },
  };
}
