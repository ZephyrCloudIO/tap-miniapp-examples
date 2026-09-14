import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import {
  createEmptyCalendarState,
  isCalendarState,
  migrateLegacyEventTypeAvailabilitySchedules,
  type CalendarState,
} from "./domain";
import {
  calendarPrincipalStorageAddresses,
  legacyCalendarStorageAddresses,
  mayAdoptLegacyCalendarStorage,
} from "./principal-storage";

const previewKey = "tap-example.tap-calendar.preview.v2";

const previewStorageKey = (principalId: string): string =>
  `${previewKey}:${encodeURIComponent(principalId)}`;

export interface LoadedCalendarState {
  readonly state: CalendarState;
  readonly revision: number | null;
}

export class CalendarStorageConflictError extends Error {}

export async function loadCalendarState(
  preview: boolean,
  principalId: string,
): Promise<LoadedCalendarState> {
  const address = calendarPrincipalStorageAddresses(principalId).state;
  if (preview) {
    try {
      const raw = globalThis.localStorage?.getItem(previewStorageKey(principalId)) ??
        (mayAdoptLegacyCalendarStorage(principalId)
          ? globalThis.localStorage?.getItem(previewKey)
          : null);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isCalendarState(parsed)) {
          return {
            state: migrateLegacyEventTypeAvailabilitySchedules(parsed),
            revision: null,
          };
        }
      }
    } catch {
      // Private browsing and disabled storage still get a usable empty state.
    }
    return { state: createEmptyCalendarState(), revision: null };
  }

  const entry = await sdk.storage.get(address);
  if (isCalendarState(entry.value)) {
    return {
      state: migrateLegacyEventTypeAvailabilitySchedules(entry.value),
      revision: entry.revision,
    };
  }
  if (entry.value === null && mayAdoptLegacyCalendarStorage(principalId)) {
    const legacy = await sdk.storage.get(legacyCalendarStorageAddresses.state);
    if (isCalendarState(legacy.value)) {
      const migratedLegacy = migrateLegacyEventTypeAvailabilitySchedules(legacy.value);
      try {
        const adopted = await sdk.storage.set({
          ...address,
          expectedRevision: null,
          value: JSON.parse(JSON.stringify(migratedLegacy)),
        });
        return { state: migratedLegacy, revision: adopted.revision };
      } catch {
        const raced = await sdk.storage.get(address);
        if (isCalendarState(raced.value)) {
          return {
            state: migrateLegacyEventTypeAvailabilitySchedules(raced.value),
            revision: raced.revision,
          };
        }
        throw new CalendarStorageConflictError(
          "TAP Calendar could not safely adopt the legacy owner state.",
        );
      }
    }
  }
  return { state: createEmptyCalendarState(), revision: entry.revision };
}

export async function saveCalendarState(
  state: CalendarState,
  preview: boolean,
  expectedRevision: number | null,
  principalId: string,
): Promise<number | null> {
  const address = calendarPrincipalStorageAddresses(principalId).state;
  if (preview) {
    try {
      globalThis.localStorage?.setItem(
        previewStorageKey(principalId),
        JSON.stringify(state),
      );
    } catch (error) {
      throw new CalendarStorageConflictError(
        error instanceof Error
          ? error.message
          : "Local Calendar storage is unavailable.",
      );
    }
    return null;
  }
  try {
    const stored = await sdk.storage.set({
      ...address,
      expectedRevision,
      value: JSON.parse(JSON.stringify(state)),
    });
    return stored.revision;
  } catch (error) {
    throw new CalendarStorageConflictError(
      error instanceof Error
        ? error.message
        : "TAP Calendar changed in another session.",
    );
  }
}

export function resetPreviewCalendar(principalId: string): void {
  try {
    globalThis.localStorage?.removeItem(previewStorageKey(principalId));
  } catch {
    // Reset is best effort when browser storage is unavailable.
  }
}
