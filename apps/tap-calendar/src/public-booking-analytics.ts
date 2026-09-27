import type { CalendarState, FunnelAnalytics } from "./domain";

export const PUBLIC_BOOKING_ANALYTICS_SCHEMA = "tap.calendar.public-booking-analytics.v2" as const;
export interface PublicBookingMetrics extends FunnelAnalytics {
  readonly lifetimeConfirmed: number;
  readonly cancelled: number;
  readonly pending: number;
  readonly declined: number;
  readonly expired: number;
  readonly conversionViews: number;
  readonly convertedVisits: number;
}
export interface PublicBookingAnalytics {
  readonly schemaVersion: typeof PUBLIC_BOOKING_ANALYTICS_SCHEMA;
  readonly generatedAt: string;
  readonly trafficSince: string;
  readonly conversionSince: string;
  readonly totals: PublicBookingMetrics;
  readonly pages: readonly {
    readonly sourceProfileId: string;
    readonly sourceEventTypeId: string;
    readonly analytics: PublicBookingMetrics;
  }[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const emptyPublicBookingMetrics: PublicBookingMetrics = {
  views: 0, slotViews: 0, starts: 0, requests: 0, confirmed: 0, lifetimeConfirmed: 0,
  cancelled: 0, pending: 0, declined: 0, expired: 0, conversionViews: 0, convertedVisits: 0,
};
const stages = Object.keys(emptyPublicBookingMetrics) as (keyof PublicBookingMetrics)[];
const instant = (value: unknown): value is string => typeof value === "string" &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function validMetrics(value: unknown): value is PublicBookingMetrics {
  if (!record(value) || !stages.every(stage => typeof value[stage] === "number" &&
    Number.isSafeInteger(value[stage]) && value[stage] >= 0)) return false;
  const n = (key: keyof PublicBookingMetrics) => value[key] as number;
  return n("starts") <= n("slotViews") && n("slotViews") <= n("views") &&
    n("confirmed") <= n("lifetimeConfirmed") && n("lifetimeConfirmed") <= n("requests") &&
    n("confirmed") + n("cancelled") + n("pending") + n("declined") + n("expired") === n("requests") &&
    n("convertedVisits") <= n("conversionViews") && n("conversionViews") <= n("views");
}

export function isPublicBookingAnalytics(value: unknown): value is PublicBookingAnalytics {
  if (!record(value) || value.schemaVersion !== PUBLIC_BOOKING_ANALYTICS_SCHEMA ||
    !instant(value.generatedAt) || !instant(value.trafficSince) || !instant(value.conversionSince) ||
    value.trafficSince > value.conversionSince || value.conversionSince > value.generatedAt ||
    !validMetrics(value.totals) || !Array.isArray(value.pages)) return false;
  const keys = new Set<string>();
  const totals = { ...emptyPublicBookingMetrics };
  for (const page of value.pages) {
    if (!record(page) || typeof page.sourceProfileId !== "string" || !page.sourceProfileId ||
      typeof page.sourceEventTypeId !== "string" || !page.sourceEventTypeId ||
      !validMetrics(page.analytics)) return false;
    const key = JSON.stringify([page.sourceProfileId, page.sourceEventTypeId]);
    if (keys.has(key)) return false;
    keys.add(key);
    for (const stage of stages) totals[stage] += page.analytics[stage];
  }
  const reportedTotals = value.totals;
  return stages.every(stage => totals[stage] === reportedTotals[stage]);
}

export function publicBookingPageMetrics(snapshot: PublicBookingAnalytics | null, profileId: string, eventTypeId: string) {
  return snapshot?.pages.find(page => page.sourceProfileId === profileId && page.sourceEventTypeId === eventTypeId)
    ?.analytics ?? emptyPublicBookingMetrics;
}

/** Confirmed visits divided by visits from the same attribution coverage period. */
export function publicBookingConversion(metrics: PublicBookingMetrics): string {
  return metrics.conversionViews === 0 ? "—" : `${(100 * metrics.convertedVisits / metrics.conversionViews).toFixed(1)}%`;
}

/** A read projection only: never persist server metrics into organizer drafts. */
export function applyPublicBookingAnalytics(state: CalendarState, snapshot: PublicBookingAnalytics | null): CalendarState {
  const byProfile = new Map<string, Map<string, FunnelAnalytics>>();
  for (const page of snapshot?.pages ?? []) {
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
        analytics: byProfile.get(profile.id)?.get(eventType.id) ?? emptyPublicBookingMetrics,
      })),
    })),
  };
}
