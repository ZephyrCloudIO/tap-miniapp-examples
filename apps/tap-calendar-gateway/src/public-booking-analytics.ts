export type PublicBookingFunnelStage = "views" | "slotViews" | "starts";

export function parsePublicBookingFunnelEvent(value: Readonly<Record<string, unknown>>): {
  readonly visitId: string;
  readonly stage: PublicBookingFunnelStage;
} | null {
  if (Object.keys(value).length !== 2 ||
    typeof value.visitId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.visitId) ||
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

interface AnalyticsRow {
  readonly source_profile_id: string;
  readonly source_event_type_id: string;
  readonly views: number;
  readonly slot_views: number;
  readonly starts: number;
  readonly requests: number;
  readonly confirmed: number;
}

export async function loadPublicBookingAnalytics(database: D1Database, scope: {
  readonly workspace: string;
  readonly principal: string;
}) {
  // Resolve every immutable revision back to its original Event Type, including
  // renamed, paused and unpublished pages. Committed attempts are unique, so
  // guest retries and reschedules never inflate the lifetime booking counts.
  const rows = await database.withSession("first-primary").prepare(
    `WITH owned_pages AS (
       SELECT pages.id, profiles.source_profile_id, pages.source_event_type_id
         FROM public_booking_pages AS pages
         JOIN public_booking_profiles AS profiles ON profiles.id = pages.profile_id
        WHERE profiles.workspace_id = ? AND profiles.principal_id = ?
     ), visits AS (
       SELECT visits.page_id, COUNT(*) AS views,
              SUM(visits.slot_viewed) AS slot_views, SUM(visits.started) AS starts
         FROM public_booking_funnel_visits AS visits
         JOIN owned_pages ON owned_pages.id = visits.page_id
        GROUP BY visits.page_id
     ), bookings AS (
       SELECT revisions.page_id, COUNT(*) AS requests,
              SUM(CASE WHEN json_extract(attempts.response_json, '$.status') = 'confirmed'
                         OR commits.resolution_status = 'approved'
                         OR EXISTS (
                           SELECT 1 FROM public_booking_email_outbox AS notices
                            WHERE notices.booking_reference = attempts.booking_reference
                              AND notices.event_key = 'approval-approved:' || attempts.booking_reference
                              AND notices.workspace_id = attempts.workspace_id
                              AND notices.principal_id = attempts.principal_id
                         ) THEN 1 ELSE 0 END) AS confirmed
         FROM public_booking_attempts AS attempts
         JOIN public_booking_page_revisions AS revisions ON revisions.id = attempts.revision_id
         JOIN owned_pages ON owned_pages.id = revisions.page_id
         LEFT JOIN provider_booking_commits AS commits
           ON commits.workspace_id = attempts.workspace_id
          AND commits.principal_id = attempts.principal_id
          AND commits.idempotency_key = attempts.provider_operation_id
        WHERE attempts.workspace_id = ? AND attempts.principal_id = ?
          AND attempts.state = 'committed'
        GROUP BY revisions.page_id
     )
     SELECT owned_pages.source_profile_id, owned_pages.source_event_type_id,
            COALESCE(visits.views, 0) AS views, COALESCE(visits.slot_views, 0) AS slot_views,
            COALESCE(visits.starts, 0) AS starts, COALESCE(bookings.requests, 0) AS requests,
            COALESCE(bookings.confirmed, 0) AS confirmed
       FROM owned_pages
       LEFT JOIN visits ON visits.page_id = owned_pages.id
       LEFT JOIN bookings ON bookings.page_id = owned_pages.id
      ORDER BY owned_pages.source_profile_id, owned_pages.source_event_type_id`,
  ).bind(scope.workspace, scope.principal, scope.workspace, scope.principal).all<AnalyticsRow>();
  return {
    pages: rows.results.map(row => ({
      sourceProfileId: row.source_profile_id,
      sourceEventTypeId: row.source_event_type_id,
      analytics: {
        views: row.views, slotViews: row.slot_views, starts: row.starts,
        requests: row.requests, confirmed: row.confirmed,
      },
    })),
  };
}
