import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import {
  createEmptyCalendarEventCache,
  isCalendarEventCacheSnapshot,
  pruneCalendarEventCache,
  type CalendarEventCacheSnapshot,
} from "./event-cache";
import {
  calendarPrincipalStorageAddresses,
  legacyCalendarStorageAddresses,
  mayAdoptLegacyCalendarStorage,
} from "./principal-storage";

export const previewCalendarEventCacheStorageKey =
  "tap-example.tap-calendar.provider-event-cache.v1";

const previewStorageKey = (principalId: string): string =>
  `${previewCalendarEventCacheStorageKey}:${encodeURIComponent(principalId)}`;

export interface LoadedCalendarEventCache {
  readonly cache: CalendarEventCacheSnapshot;
  readonly revision: number | null;
}

export async function loadCalendarEventCache(
  preview: boolean,
  principalId: string,
): Promise<LoadedCalendarEventCache> {
  const address = calendarPrincipalStorageAddresses(principalId).eventCache;
  if (preview) {
    try {
      const raw = globalThis.localStorage?.getItem(previewStorageKey(principalId)) ??
        (mayAdoptLegacyCalendarStorage(principalId)
          ? globalThis.localStorage?.getItem(previewCalendarEventCacheStorageKey)
          : null);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isCalendarEventCacheSnapshot(parsed)) {
          return { cache: pruneCalendarEventCache(parsed), revision: null };
        }
      }
    } catch {
      // A private or disabled browser store still gets an in-memory cache.
    }
    return { cache: createEmptyCalendarEventCache(), revision: null };
  }

  const entry = await sdk.storage.get(address);
  if (entry.value === null && mayAdoptLegacyCalendarStorage(principalId)) {
    const legacy = await sdk.storage.get(legacyCalendarStorageAddresses.eventCache);
    if (isCalendarEventCacheSnapshot(legacy.value)) {
      const bounded = pruneCalendarEventCache(legacy.value);
      try {
        const adopted = await sdk.storage.set({
          ...address,
          expectedRevision: null,
          value: JSON.parse(JSON.stringify(bounded)),
        });
        return { cache: bounded, revision: adopted.revision };
      } catch {
        const raced = await sdk.storage.get(address);
        if (isCalendarEventCacheSnapshot(raced.value)) {
          return {
            cache: pruneCalendarEventCache(raced.value),
            revision: raced.revision,
          };
        }
      }
    }
  }
  return {
    cache: isCalendarEventCacheSnapshot(entry.value)
      ? pruneCalendarEventCache(entry.value)
      : createEmptyCalendarEventCache(),
    revision: entry.revision,
  };
}

export async function saveCalendarEventCache(
  cache: CalendarEventCacheSnapshot,
  preview: boolean,
  expectedRevision: number | null,
  principalId: string,
): Promise<number | null> {
  const address = calendarPrincipalStorageAddresses(principalId).eventCache;
  const bounded = pruneCalendarEventCache(cache);
  if (preview) {
    globalThis.localStorage?.setItem(
      previewStorageKey(principalId),
      JSON.stringify(bounded),
    );
    return null;
  }
  const stored = await sdk.storage.set({
    ...address,
    expectedRevision,
    value: JSON.parse(JSON.stringify(bounded)),
  });
  return stored.revision;
}
