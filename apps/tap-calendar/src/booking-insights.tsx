import { useId } from "react";
import {
  publicBookingConversion,
  type PublicBookingAnalytics,
  type PublicBookingMetrics,
} from "./public-booking-analytics";

export function analyticsDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Only join funnel stages when their tracking periods match. */
export function bookingVisitSteps(metrics: PublicBookingMetrics, snapshot: PublicBookingAnalytics) {
  const steps = [
    { label: "Page visits", count: metrics.views },
    { label: "Viewed available times", count: metrics.slotViews },
    { label: "Reached guest details", count: metrics.starts },
  ];
  if (snapshot.trafficSince === snapshot.conversionSince) {
    steps.push({ label: "Booked visits", count: metrics.convertedVisits });
  }
  return steps;
}

export function BookingInsights({ metrics, snapshot, preview = false }: {
  readonly metrics: PublicBookingMetrics;
  readonly snapshot: PublicBookingAnalytics | null;
  readonly preview?: boolean;
}) {
  const id = useId();
  if (!snapshot) {
    return <div className="booking-insights-empty" role="status">
      <h3>{preview ? "Preview activity" : "Insights unavailable"}</h3>
      <p>{preview
        ? "Visit conversion is measured on your published booking page. Open Calendar in TAP to see live insights."
        : "We couldn’t load booking analytics. Close this dialog and try again when your connection is restored."}</p>
    </div>;
  }
  const steps = bookingVisitSteps(metrics, snapshot);
  const outcomes = [
    ["Confirmed", metrics.confirmed],
    ["Cancelled", metrics.cancelled],
    ["Awaiting approval", metrics.pending],
    ["Declined", metrics.declined],
    ["Expired", metrics.expired],
  ] as const;
  return <div className="booking-insights">
    <section className="insights-conversion" aria-labelledby={`${id}-conversion`}>
      <div className="insights-section-heading">
        <h3 id={`${id}-conversion`}>Visit conversion</h3>
        <span>Since {analyticsDate(snapshot.conversionSince)}</span>
      </div>
      <div className="insights-conversion-value">
        <strong>{publicBookingConversion(metrics)}</strong>
        <p>{metrics.conversionViews === 0
          ? "No visits recorded yet. Share your booking page to start measuring conversion."
          : <><b>{metrics.convertedVisits.toLocaleString()} of {metrics.conversionViews.toLocaleString()} visits</b> led to a confirmed booking.</>}</p>
      </div>
      {metrics.requests > 0 ? <p className="insights-coverage-note">Earlier bookings have no visit history, so an all-time conversion rate is unavailable.</p> : null}
    </section>

    <section aria-labelledby={`${id}-activity`}>
      <div className="insights-section-heading">
        <h3 id={`${id}-activity`}>Booking page activity</h3>
        <span>Since {analyticsDate(snapshot.trafficSince)}</span>
      </div>
      <ol className="insights-visit-steps">
        {steps.map(({ label, count }, index) => <li key={label}>
          <span className="insights-step-number" aria-hidden="true">{index + 1}</span>
          <span className="insights-step-label">{label}</span>
          <span className="insights-step-track" aria-hidden="true"><span style={{ width: `${metrics.views ? 100 * count / metrics.views : 0}%` }} /></span>
          <strong>{count.toLocaleString()}</strong>
        </li>)}
      </ol>
    </section>

    <section className="insights-bookings" aria-labelledby={`${id}-bookings`}>
      <div className="insights-section-heading">
        <h3 id={`${id}-bookings`}>All-time bookings</h3>
        <span>{metrics.requests.toLocaleString()} total requests</span>
      </div>
      <dl className="insights-outcomes">
        {outcomes.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count.toLocaleString()}</dd></div>)}
      </dl>
      <p className="insights-booking-note">{metrics.lifetimeConfirmed.toLocaleString()} confirmed in total, including later cancellations.</p>
    </section>

    <details className="insights-definitions">
      <summary>How these numbers work</summary>
      <dl>
        <div><dt>Page visits</dt><dd>Each page load starts a visit. Moving between steps and retrying a booking stay within the same visit.</dd></div>
        <div><dt>Booked visits</dt><dd>A visit that led to at least one confirmed booking. Multiple bookings count once; later cancellations do not remove the conversion.</dd></div>
        <div><dt>Tracking period</dt><dd>Visits are recorded from {new Date(snapshot.trafficSince).toLocaleString()}. Conversion uses visits from {new Date(snapshot.conversionSince).toLocaleString()}.</dd></div>
        <div><dt>All-time bookings</dt><dd>Current status of all requests made through this public booking page, including requests before visit tracking began.</dd></div>
      </dl>
    </details>
    <p className="insights-updated">Updated {new Date(snapshot.generatedAt).toLocaleString()}</p>
  </div>;
}
