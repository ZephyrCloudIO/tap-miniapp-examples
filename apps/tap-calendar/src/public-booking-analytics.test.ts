import { describe, expect, it } from "@rstest/core";
import { applyPublicBookingAnalytics, isPublicBookingAnalytics } from "./public-booking-analytics";
import { createCalendarGatewayClient } from "./gateway";
import { createInitialCalendarState } from "./test-fixtures";

describe("public booking analytics", () => {
  it("replaces preview counters by stable profile/Event Type IDs without changing stored drafts", () => {
    const state = createInitialCalendarState();
    const profile = state.bookingProfiles[0]!;
    const eventType = profile.eventTypes[0]!;
    const original = JSON.stringify(state);
    const analytics = { views: 0, slotViews: 0, starts: 0, requests: 7, confirmed: 5 };
    const snapshot = { pages: [{ sourceProfileId: profile.id, sourceEventTypeId: eventType.id, analytics }] };
    const updated = applyPublicBookingAnalytics(state, snapshot);
    expect(updated.bookingProfiles[0]!.eventTypes[0]!.analytics).toEqual(analytics);
    expect(JSON.stringify(state)).toBe(original);
    expect(applyPublicBookingAnalytics(updated, snapshot)).toEqual(updated);
    expect(applyPublicBookingAnalytics(state, { pages: [{ ...snapshot.pages[0]!, sourceProfileId: "other-profile" }] })
      .bookingProfiles[0]!.eventTypes[0]!.analytics.confirmed).toBe(0);
  });

  it("rejects invalid, negative, and duplicated server counters", () => {
    const page = { sourceProfileId: "profile", sourceEventTypeId: "event", analytics: {
      views: 0, slotViews: 0, starts: 0, requests: 2, confirmed: 1,
    } };
    expect(isPublicBookingAnalytics({ pages: [page] })).toBe(true);
    expect(isPublicBookingAnalytics({ pages: [page, page] })).toBe(false);
    for (const confirmed of [-1, 0.5, "1", null, Number.POSITIVE_INFINITY]) {
      expect(isPublicBookingAnalytics({ pages: [{ ...page, analytics: { ...page.analytics, confirmed } }] })).toBe(false);
    }
  });

  it("reads through the organizer gateway with scoped identity and validates the response", async () => {
    const calls: string[] = [];
    let result: unknown = { pages: [] };
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
    expect(await gateway.publicBookingAnalytics()).toEqual({ pages: [] });
    expect(calls).toEqual(["https://calendar-api.theaiplatform.app/v1/publications/analytics"]);
    result = { confirmed: 100 };
    await expect(gateway.publicBookingAnalytics()).rejects.toThrow("invalid booking analytics");
  });
});
