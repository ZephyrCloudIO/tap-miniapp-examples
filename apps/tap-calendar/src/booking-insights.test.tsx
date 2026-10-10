import { describe, expect, it } from "@rstest/core";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingInsights, bookingVisitSteps } from "./booking-insights";
import { emptyPublicBookingMetrics, PUBLIC_BOOKING_ANALYTICS_SCHEMA, type PublicBookingAnalytics } from "./public-booking-analytics";

// Historical bookings predate all four tracked visits (the reported production case).
const metrics = {
  ...emptyPublicBookingMetrics, views: 4, slotViews: 1, starts: 1,
  requests: 12, lifetimeConfirmed: 12, confirmed: 11, cancelled: 1, conversionViews: 4,
};
const snapshot: PublicBookingAnalytics = {
  schemaVersion: PUBLIC_BOOKING_ANALYTICS_SCHEMA,
  trafficSince: "2026-09-25T01:51:00.033Z", conversionSince: "2026-09-25T01:51:00.033Z",
  generatedAt: "2026-09-27T20:02:13.000Z", totals: metrics, pages: [],
};

describe("booking insights reporting periods", () => {
  it("keeps historical bookings out of the visit funnel and card conversion", () => {
    expect(bookingVisitSteps(metrics, snapshot).map(step => step.count)).toEqual([4, 1, 1, 0]);
    const html = renderToStaticMarkup(<BookingInsights metrics={metrics} snapshot={snapshot} />);
    expect(html).toContain("0 of 4 visits");
    expect(html).toContain("All-time bookings");
    expect(html).toContain("12 total requests");
    expect(html).toContain("all-time conversion rate is unavailable");
  });

  it("keeps different traffic and conversion periods separate", () => {
    const laterCoverage = { ...snapshot, conversionSince: "2026-09-26T00:00:00.000Z" };
    const differentCohorts = { ...metrics, views: 100, slotViews: 40, starts: 20, convertedVisits: 1 };
    expect(bookingVisitSteps(differentCohorts, laterCoverage).map(step => step.count)).toEqual([100, 40, 20]);
  });

  it("distinguishes unavailable data, no visits, and measured zero conversion", () => {
    const unavailable = renderToStaticMarkup(<BookingInsights metrics={metrics} snapshot={null} />);
    expect(unavailable).toContain("Insights unavailable");
    expect(unavailable).not.toContain("0.0%");
    const empty = renderToStaticMarkup(<BookingInsights metrics={emptyPublicBookingMetrics} snapshot={snapshot} />);
    expect(empty).toContain("No visits recorded yet");
    expect(empty).not.toContain("0.0%");
    const zero = renderToStaticMarkup(<BookingInsights metrics={metrics} snapshot={snapshot} />);
    expect(zero).toContain("0.0%");
    const preview = renderToStaticMarkup(<BookingInsights metrics={metrics} snapshot={null} preview />);
    expect(preview).toContain("Preview activity");
    expect(preview).not.toContain("0.0%");
  });
});
