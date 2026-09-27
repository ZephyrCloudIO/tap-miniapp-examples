import { describe, expect, it } from "@rstest/core";
import {
  applyPublicBookingAnalytics, isPublicBookingAnalytics, publicBookingConversion,
  emptyPublicBookingMetrics, PUBLIC_BOOKING_ANALYTICS_SCHEMA, type PublicBookingAnalytics,
} from "./public-booking-analytics";
import { createCalendarGatewayClient } from "./gateway";
import { createInitialCalendarState } from "./test-fixtures";

const snapshotFor = (pages: PublicBookingAnalytics["pages"] = []): PublicBookingAnalytics => ({
  schemaVersion: PUBLIC_BOOKING_ANALYTICS_SCHEMA,
  generatedAt: "2026-09-25T12:00:00.000Z", trafficSince: "2026-09-24T12:00:00.000Z",
  conversionSince: "2026-09-24T12:00:00.000Z", pages,
  totals: pages.reduce((sum, page) => {
    for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += page.analytics[key];
    return sum;
  }, { ...emptyPublicBookingMetrics }),
});

describe("public booking analytics", () => {
  it("replaces preview counters without changing drafts or dropping server totals for missing local pages", () => {
    const state = createInitialCalendarState();
    const profile = state.bookingProfiles[0]!;
    const eventType = profile.eventTypes[0]!;
    const original = JSON.stringify(state);
    const analytics = { ...emptyPublicBookingMetrics, requests: 7, confirmed: 4, lifetimeConfirmed: 5, cancelled: 1, pending: 2 };
    const snapshot = snapshotFor([{ sourceProfileId: profile.id, sourceEventTypeId: eventType.id, analytics }]);
    const updated = applyPublicBookingAnalytics(state, snapshot);
    expect(updated.bookingProfiles[0]!.eventTypes[0]!.analytics).toEqual(analytics);
    expect(JSON.stringify(state)).toBe(original);
    expect(applyPublicBookingAnalytics(updated, snapshot)).toEqual(updated);
    const orphaned = snapshotFor([{ ...snapshot.pages[0]!, sourceProfileId: "other-profile" }]);
    expect(applyPublicBookingAnalytics(state, orphaned).bookingProfiles[0]!.eventTypes[0]!.analytics.confirmed).toBe(0);
    expect(orphaned.totals.confirmed).toBe(4);
    expect(applyPublicBookingAnalytics(state, null).bookingProfiles[0]!.eventTypes[0]!.analytics.views).toBe(0);
  });

  it("rejects old schemas, impossible funnels, inconsistent summaries, and corrupt counters", () => {
    const page = { sourceProfileId: "profile", sourceEventTypeId: "event", analytics: {
      ...emptyPublicBookingMetrics, requests: 2, confirmed: 1, lifetimeConfirmed: 1, pending: 1,
    } };
    const snapshot = snapshotFor([page]);
    expect(isPublicBookingAnalytics(snapshot)).toBe(true);
    expect(isPublicBookingAnalytics({ pages: [page] })).toBe(false);
    expect(isPublicBookingAnalytics(snapshotFor([page, page]))).toBe(false);
    expect(isPublicBookingAnalytics({ ...snapshot, totals: emptyPublicBookingMetrics })).toBe(false);
    expect(isPublicBookingAnalytics({ ...snapshot, generatedAt: "invalid" })).toBe(false);
    for (const change of [
      { confirmed: -1 }, { confirmed: 0.5 }, { confirmed: "1" }, { confirmed: null },
      { confirmed: Infinity }, { lifetimeConfirmed: 0 }, { starts: 1 }, { convertedVisits: 1 },
      { cancelled: 2 }, { conversionViews: 1 },
    ]) {
      expect(isPublicBookingAnalytics({ ...snapshot, pages: [{ ...page, analytics: { ...page.analytics, ...change } }] })).toBe(false);
    }
  });

  it("calculates conversion from attributed visits, never lifetime/current booking counts", () => {
    const metrics = { ...emptyPublicBookingMetrics, views: 100, conversionViews: 4, convertedVisits: 1,
      requests: 50, confirmed: 39, lifetimeConfirmed: 40, cancelled: 11 };
    expect(publicBookingConversion(metrics)).toBe("25.0%");
    expect(publicBookingConversion({ ...metrics, confirmed: 0, cancelled: 50 })).toBe("25.0%");
    expect(publicBookingConversion(emptyPublicBookingMetrics)).toBe("—");
  });

  it("uses authenticated v2 analytics and fails closed on an outdated gateway", async () => {
    const calls: string[] = [];
    let result: unknown = snapshotFor();
    const gateway = createCalendarGatewayClient({
      baseUrl: "https://calendar-api.theaiplatform.app", workspaceId: "workspace", principalId: "user",
      transport: async (url, input) => {
        calls.push(url);
        expect(input.method).toBe("GET");
        expect(input.headers).toContainEqual({ name: "X-TAP-Principal-Id", value: "user" });
        expect(input.headers).toContainEqual({ name: "X-TAP-Workspace-Id", value: "workspace" });
        return { status: 200, bodyText: JSON.stringify(result) };
      },
    });
    expect(await gateway.publicBookingAnalytics()).toEqual(snapshotFor());
    expect(calls).toEqual(["https://calendar-api.theaiplatform.app/v2/publications/analytics"]);
    result = { pages: [] };
    await expect(gateway.publicBookingAnalytics()).rejects.toThrow("invalid booking analytics");
  });
});
