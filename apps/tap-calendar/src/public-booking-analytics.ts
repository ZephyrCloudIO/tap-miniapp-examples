import type { CalendarState, FunnelAnalytics } from "./domain";

export interface PublicBookingAnalytics {
  readonly pages: readonly {
    readonly sourceProfileId: string;
    readonly sourceEventTypeId: string;
    readonly analytics: FunnelAnalytics;
  }[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stages = ["views", "slotViews", "starts", "requests", "confirmed"] as const;

export function isPublicBookingAnalytics(value: unknown): value is PublicBookingAnalytics {
  if (!record(value) || !Array.isArray(value.pages)) return false;
  const keys = new Set<string>();
  return value.pages.every(page => {
    if (!record(page) || typeof page.sourceProfileId !== "string" || !page.sourceProfileId ||
      typeof page.sourceEventTypeId !== "string" || !page.sourceEventTypeId ||
      !record(page.analytics)) return false;
    const metrics = page.analytics;
    if (!stages.every(stage => typeof metrics[stage] === "number" &&
      Number.isSafeInteger(metrics[stage]) && metrics[stage] >= 0)) return false;
    const key = JSON.stringify([page.sourceProfileId, page.sourceEventTypeId]);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

const emptyAnalytics: FunnelAnalytics = { views: 0, slotViews: 0, starts: 0, requests: 0, confirmed: 0 };

/** A read projection only: never persist server metrics into organizer drafts. */
export function applyPublicBookingAnalytics(state: CalendarState, snapshot: PublicBookingAnalytics): CalendarState {
  const byProfile = new Map<string, Map<string, FunnelAnalytics>>();
  for (const page of snapshot.pages) {
    const eventTypes = byProfile.get(page.sourceProfileId) ?? new Map<string, FunnelAnalytics>();
    eventTypes.set(page.sourceEventTypeId, page.analytics);
    byProfile.set(page.sourceProfileId, eventTypes);
  }
  return {
    ...state,
    bookingProfiles: state.bookingProfiles.map(profile => ({
      ...profile,
      eventTypes: profile.eventTypes.map(eventType => ({
        ...eventType,
        analytics: byProfile.get(profile.id)?.get(eventType.id) ?? emptyAnalytics,
      })),
    })),
  };
}
