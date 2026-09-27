export const PUBLIC_VISIT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type PublicBookingFunnelStage = "views" | "slotViews" | "starts";

export function parsePublicBookingFunnelEvent(value: Readonly<Record<string, unknown>>): {
  readonly visitId: string;
  readonly stage: PublicBookingFunnelStage;
} | null {
  if (Object.keys(value).length !== 2 ||
    typeof value.visitId !== "string" ||
    !PUBLIC_VISIT_ID_PATTERN.test(value.visitId) ||
    (value.stage !== "views" && value.stage !== "slotViews" && value.stage !== "starts")) return null;
  return { visitId: value.visitId.toLowerCase(), stage: value.stage };
}

export async function recordPublicBookingFunnelEvent(
  database: D1Database,
  pageId: string,
  event: { readonly visitId: string; readonly stage: PublicBookingFunnelStage },
): Promise<void> {
  // Later stages imply earlier stages, so network reordering/retries cannot
  // duplicate a visit or leave starts without a corresponding page view.
  await database.prepare(
    `INSERT INTO public_booking_funnel_visits
       (page_id, visit_id, slot_viewed, started, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (page_id, visit_id) DO UPDATE SET
       slot_viewed = MAX(slot_viewed, excluded.slot_viewed),
       started = MAX(started, excluded.started)`,
  ).bind(pageId, event.visitId, Number(event.stage !== "views"),
    Number(event.stage === "starts"), new Date().toISOString()).run();
}

export const PUBLIC_BOOKING_ANALYTICS_SCHEMA = "tap.calendar.public-booking-analytics.v2" as const;

interface AnalyticsRow {
  readonly source_profile_id: string;
  readonly source_event_type_id: string;
  readonly views: number;
  readonly slot_views: number;
  readonly starts: number;
  readonly requests: number;
  readonly confirmed: number;
  readonly lifetime_confirmed: number;
  readonly cancelled: number;
  readonly pending: number;
  readonly declined: number;
  readonly expired: number;
  readonly conversion_views: number;
  readonly converted_visits: number;
}

export async function loadPublicBookingAnalytics(database: D1Database, scope: {
  readonly workspace: string;
  readonly principal: string;
}) {
  const session = database.withSession("first-primary");
  const coverage = await session.prepare(
    "SELECT traffic_since, conversion_since FROM public_booking_analytics_coverage WHERE id = 1",
  ).first<{ traffic_since: string; conversion_since: string }>();
  if (!coverage) throw new Error("Booking analytics coverage has not been initialized.");
  const rows = await session.prepare(
    `WITH owned_pages AS (
       SELECT pages.id, profiles.source_profile_id, pages.source_event_type_id
         FROM public_booking_pages AS pages
         JOIN public_booking_profiles AS profiles ON profiles.id = pages.profile_id
        WHERE profiles.workspace_id = ? AND profiles.principal_id = ?
          AND profiles.owner_kind = 'individual'
     ), booking_facts AS (
       SELECT revisions.page_id, attempts.visit_id,
              CASE WHEN management.status = 'cancelled' THEN 'cancelled'
                   ELSE COALESCE(management.booking_status,
                     CASE WHEN commits.resolution_status = 'approved' THEN 'confirmed'
                          WHEN commits.resolution_status = 'declined' THEN 'declined'
                          WHEN commits.hold_expired_at IS NOT NULL THEN 'expired'
                          ELSE json_extract(attempts.response_json, '$.status') END) END AS current_status,
              CASE WHEN attempts.first_confirmed_at IS NOT NULL
                         OR json_extract(attempts.response_json, '$.status') = 'confirmed'
                         OR management.booking_status = 'confirmed'
                         OR commits.resolution_status = 'approved'
                         OR EXISTS (
                           SELECT 1 FROM public_booking_email_outbox AS notices
                            WHERE notices.booking_reference = attempts.booking_reference
                              AND notices.event_key = 'approval-approved:' || attempts.booking_reference
                              AND notices.workspace_id = attempts.workspace_id
                              AND notices.principal_id = attempts.principal_id
                         ) THEN 1 ELSE 0 END AS ever_confirmed
         FROM public_booking_attempts AS attempts
         JOIN public_booking_page_revisions AS revisions ON revisions.id = attempts.revision_id
         JOIN owned_pages ON owned_pages.id = revisions.page_id
         LEFT JOIN public_booking_management_credentials AS management
           ON management.booking_reference = attempts.booking_reference
          AND management.workspace_id = attempts.workspace_id AND management.principal_id = attempts.principal_id
         LEFT JOIN provider_booking_commits AS commits
           ON commits.workspace_id = attempts.workspace_id AND commits.principal_id = attempts.principal_id
          AND commits.idempotency_key = attempts.provider_operation_id
        WHERE attempts.workspace_id = ? AND attempts.principal_id = ? AND attempts.state = 'committed'
     ), visits AS (
       SELECT visits.page_id, COUNT(*) AS views,
              SUM(visits.slot_viewed) AS slot_views, SUM(visits.started) AS starts,
              SUM(CASE WHEN visits.created_at >= ? THEN 1 ELSE 0 END) AS conversion_views,
              SUM(CASE WHEN visits.created_at >= ? AND EXISTS (
                SELECT 1 FROM booking_facts b WHERE b.page_id = visits.page_id
                  AND b.visit_id = visits.visit_id AND b.ever_confirmed = 1
              ) THEN 1 ELSE 0 END) AS converted_visits
         FROM public_booking_funnel_visits AS visits
         JOIN owned_pages ON owned_pages.id = visits.page_id
        GROUP BY visits.page_id
     ), bookings AS (
       SELECT page_id, COUNT(*) AS requests, SUM(ever_confirmed) AS lifetime_confirmed,
              SUM(current_status = 'confirmed') AS confirmed,
              SUM(current_status = 'cancelled') AS cancelled,
              SUM(current_status = 'pending') AS pending,
              SUM(current_status = 'declined') AS declined,
              SUM(current_status = 'expired') AS expired
         FROM booking_facts GROUP BY page_id
     )
     SELECT owned_pages.source_profile_id, owned_pages.source_event_type_id,
            COALESCE(visits.views, 0) AS views, COALESCE(visits.slot_views, 0) AS slot_views,
            COALESCE(visits.starts, 0) AS starts, COALESCE(bookings.requests, 0) AS requests,
            COALESCE(bookings.confirmed, 0) AS confirmed,
            COALESCE(bookings.lifetime_confirmed, 0) AS lifetime_confirmed,
            COALESCE(bookings.cancelled, 0) AS cancelled, COALESCE(bookings.pending, 0) AS pending,
            COALESCE(bookings.declined, 0) AS declined, COALESCE(bookings.expired, 0) AS expired,
            COALESCE(visits.conversion_views, 0) AS conversion_views,
            COALESCE(visits.converted_visits, 0) AS converted_visits
       FROM owned_pages
       LEFT JOIN visits ON visits.page_id = owned_pages.id
       LEFT JOIN bookings ON bookings.page_id = owned_pages.id
      ORDER BY owned_pages.source_profile_id, owned_pages.source_event_type_id`,
  ).bind(scope.workspace, scope.principal, scope.workspace, scope.principal,
    coverage.conversion_since, coverage.conversion_since).all<AnalyticsRow>();
  const pages = rows.results.map(row => ({
    sourceProfileId: row.source_profile_id,
    sourceEventTypeId: row.source_event_type_id,
    analytics: {
      views: row.views, slotViews: row.slot_views, starts: row.starts,
      requests: row.requests, confirmed: row.confirmed, lifetimeConfirmed: row.lifetime_confirmed,
      cancelled: row.cancelled, pending: row.pending, declined: row.declined, expired: row.expired,
      conversionViews: row.conversion_views, convertedVisits: row.converted_visits,
    },
  }));
  const totals = { views: 0, slotViews: 0, starts: 0, requests: 0, confirmed: 0,
    lifetimeConfirmed: 0, cancelled: 0, pending: 0, declined: 0, expired: 0,
    conversionViews: 0, convertedVisits: 0 };
  for (const page of pages) {
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += page.analytics[key];
  }
  return { schemaVersion: PUBLIC_BOOKING_ANALYTICS_SCHEMA, generatedAt: new Date().toISOString(),
    trafficSince: coverage.traffic_since, conversionSince: coverage.conversion_since, totals, pages };
}

/** Preserve lifetime semantics for older organizer packages during rollout. */
export function legacyPublicBookingAnalytics(snapshot: Awaited<ReturnType<typeof loadPublicBookingAnalytics>>) {
  return { pages: snapshot.pages.map(page => ({
    sourceProfileId: page.sourceProfileId, sourceEventTypeId: page.sourceEventTypeId,
    analytics: { views: page.analytics.views, slotViews: page.analytics.slotViews,
      starts: page.analytics.starts, requests: page.analytics.requests, confirmed: page.analytics.lifetimeConfirmed },
  })) };
}
