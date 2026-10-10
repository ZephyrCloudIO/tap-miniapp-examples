import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shiftCalendarAnchor } from "./calendar-navigation";
import type { CalendarEvent, CalendarView } from "./domain";
import {
  applyCalendarRemovalTombstones,
  findCalendarEventCacheEntry,
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
/** A range fetched this recently is shown without asking the gateway again. */
export const CALENDAR_EVENT_REUSE_MS = 60_000;
/** Partial ranges retry sooner than complete ones, but never on every focus. */
export const CALENDAR_EVENT_PARTIAL_RETRY_MS = 60_000;
/** Background reads return the gateway cache at once and refresh it server-side; one follow-up collects that refresh. */
export const CALENDAR_EVENT_FOLLOW_UP_DELAY_MS = 5_000;
const CALENDAR_EVENT_PREFETCH_ACCESS_TIME = "1970-01-01T00:00:00.000Z";
const CALENDAR_EVENT_TOUCH_INTERVAL_MS = 60_000;

export interface ProviderEventSyncState {
  /** `partial` means at least one calendar failed to refresh; see failedCalendarIds. */
  readonly status: "idle" | "syncing" | "ready" | "partial" | "error";
  readonly syncedAt: string | null;
  readonly eventCount: number;
  readonly failedCalendarIds: readonly string[];
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

export const syncStateForEntry = (
  entry: CalendarEventCacheEntry | null,
): ProviderEventSyncState => entry
  ? {
      status: entry.failedCalendarIds?.length ? "partial" : "ready",
      syncedAt: calendarEventCacheEntryFreshness(entry),
      eventCount: entry.events.length,
      failedCalendarIds: entry.failedCalendarIds ?? [],
    }
  : { status: "idle", syncedAt: null, eventCount: 0, failedCalendarIds: [] };

const syncingStateForEntry = (
  entry: CalendarEventCacheEntry | null,
): ProviderEventSyncState => ({
  ...syncStateForEntry(entry),
  status: "syncing",
});

/** Due when the client last asked the gateway long enough ago, not when a calendar's own data is old. */
export const needsCatchUp = (
  entry: CalendarEventCacheEntry | null,
  now = Date.now(),
): boolean => {
  if (!entry) return true;
  return now - Date.parse(entry.updatedAt) >= (
    entry.partial ? CALENDAR_EVENT_PARTIAL_RETRY_MS : CALENDAR_EVENT_REFRESH_INTERVAL_MS
  );
};

const canReuseWithoutRequest = (
  entry: CalendarEventCacheEntry | null,
  now = Date.now(),
): boolean => entry !== null && !entry.partial &&
  now - Date.parse(entry.updatedAt) < CALENDAR_EVENT_REUSE_MS;

export function useCalendarEventCache(input: {
  readonly preview: boolean;
  readonly principalId: string;
  readonly gateway: CalendarGatewayClient;
  readonly calendarIds: readonly string[];
  readonly view: CalendarView;
  readonly anchorDate: string;
  /** Skips storage and network work until a consumer needs this cache. */
  readonly enabled?: boolean;
  /**
   * `background` paints the gateway cache at once and collects the server-side
   * refresh with one follow-up read. `wait` blocks for fresh provider data and
   * suits conflict checks.
   */
  readonly revalidate?: "wait" | "background";
}): CalendarEventCacheResult {
  const enabled = input.enabled ?? true;
  const automaticMode = input.revalidate ?? "background";
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
  const followUpTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [cacheEpoch, setCacheEpoch] = useState(0);
  const [syncState, setSyncState] = useState<ProviderEventSyncState>(
    syncStateForEntry(null),
  );

  useEffect(() => {
    mountedRef.current = true;
    const followUpTimers = followUpTimersRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of followUpTimers) globalThis.clearTimeout(timer);
      followUpTimers.clear();
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
    if (!enabled) return;
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
  }, [enabled, input.preview, input.principalId]);

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
    allowFollowUp = true,
  ): Promise<void> => {
    if (range.key === currentRangeKeyRef.current) {
      setSyncState(syncingStateForEntry(
        findReusableCalendarEventCacheEntry(cacheRef.current, range),
      ));
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
          // Only the visible range counts as viewed; prefetched neighbors are evicted first.
          const merged = range.key === currentRangeKeyRef.current
            ? mergedResult
            : {
                ...mergedResult,
                lastAccessedAt: cached?.lastAccessedAt ??
                  CALENDAR_EVENT_PREFETCH_ACCESS_TIME,
              };
          const reconciled = applyCalendarRemovalTombstones(
            putCalendarEventCacheEntry(cacheRef.current, merged),
            currentTombstones,
          );
          updateCache(reconciled);
          return findReusableCalendarEventCacheEntry(reconciled, mergeRange);
        },
      );
      if (range.key !== currentRangeKeyRef.current || !mountedRef.current) return;
      if (revalidate === "background" && allowFollowUp && entry?.partial) {
        // The gateway is refreshing stale calendars after replying; read once more to collect it.
        setSyncState(syncingStateForEntry(entry));
        const timer = globalThis.setTimeout(() => {
          followUpTimersRef.current.delete(timer);
          if (
            mountedRef.current &&
            range.key === currentRangeKeyRef.current &&
            canRefreshInForeground()
          ) {
            void revalidateRange(range, "background", false);
          } else if (mountedRef.current && range.key === currentRangeKeyRef.current) {
            setSyncState(syncStateForEntry(entry));
          }
        }, CALENDAR_EVENT_FOLLOW_UP_DELAY_MS);
        followUpTimersRef.current.add(timer);
        return;
      }
      setSyncState(syncStateForEntry(entry));
    } catch {
      if (range.key !== currentRangeKeyRef.current || !mountedRef.current) return;
      const cached = findReusableCalendarEventCacheEntry(cacheRef.current, range);
      setSyncState({ ...syncStateForEntry(cached), status: "error" });
    }
  }, [input.gateway, updateCache]);

  /**
   * Loads the visible range first and prefetches neighbors afterwards so they
   * never compete with it. A range fetched within the reuse window is shown
   * as-is; `force` (manual refresh) always asks for fresh provider data.
   */
  const loadRanges = useCallback(async (
    ranges: {
      readonly current: CalendarEventRangeRequest;
      readonly adjacent: readonly CalendarEventRangeRequest[];
    },
    mode: "wait" | "background",
    force: boolean,
  ): Promise<void> => {
    const now = Date.now();
    const cached = findReusableCalendarEventCacheEntry(cacheRef.current, ranges.current);
    if (force || !canReuseWithoutRequest(cached, now)) {
      await revalidateRange(ranges.current, mode);
    }
    await Promise.all(ranges.adjacent
      .filter(range => needsCatchUp(findReusableCalendarEventCacheEntry(cacheRef.current, range), now))
      .map(range => revalidateRange(range, "background", false)));
  }, [revalidateRange]);

  const refreshRangeSet = useCallback((trigger: "manual" | "scheduled" | "catch-up") => {
    if (!enabled || !cacheLoaded || !canRefreshInForeground()) return;
    const ranges = activeRangesRef.current;
    if (!ranges.current) return;
    const cached = findReusableCalendarEventCacheEntry(
      cacheRef.current,
      ranges.current,
    );
    if (trigger === "catch-up" && !needsCatchUp(cached)) return;
    void loadRanges(
      { current: ranges.current, adjacent: ranges.adjacent },
      trigger === "manual" ? "wait" : automaticMode,
      trigger === "manual",
    );
  }, [automaticMode, cacheLoaded, enabled, loadRanges]);

  useEffect(() => {
    if (!enabled || !cacheLoaded || !currentRange) {
      setSyncState(syncStateForEntry(null));
      return;
    }
    const cached = findReusableCalendarEventCacheEntry(cacheRef.current, currentRange);
    setSyncState(syncStateForEntry(cached));
    if (!canRefreshInForeground()) return;
    void loadRanges({ current: currentRange, adjacent: adjacentRanges }, automaticMode, false);
  }, [automaticMode, cacheLoaded, currentRange?.key, enabled, loadRanges]);

  useEffect(() => {
    if (!cacheLoaded || !currentRange) return;
    // Touch only the exact entry, and at most once a minute: each touch rewrites the stored snapshot.
    const cached = findCalendarEventCacheEntry(cacheRef.current, currentRange.key);
    if (!cached) return;
    const now = Date.now();
    if (now - Date.parse(cached.lastAccessedAt) < CALENDAR_EVENT_TOUCH_INTERVAL_MS) return;
    updateCache(putCalendarEventCacheEntry(cacheRef.current, {
      ...cached,
      lastAccessedAt: new Date(now).toISOString(),
    }));
  }, [cacheLoaded, currentRange?.key, updateCache]);

  useEffect(() => {
    if (!enabled) return;
    const interval = globalThis.setInterval(
      () => refreshRangeSet("scheduled"),
      CALENDAR_EVENT_REFRESH_INTERVAL_MS,
    );
    const catchUp = () => refreshRangeSet("catch-up");
    const refreshOnline = () => refreshRangeSet("scheduled");
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
  }, [enabled, refreshRangeSet]);

  const currentEntry = currentRange
    ? findReusableCalendarEventCacheEntry(cacheRef.current, currentRange)
    : null;
  void cacheEpoch;

  return {
    events: currentEntry?.events ?? [],
    hasCompleteCoverage: currentEntry !== null && !currentEntry.partial,
    syncState,
    refresh: () => refreshRangeSet("manual"),
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
