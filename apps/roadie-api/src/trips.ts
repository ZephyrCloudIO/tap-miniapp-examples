import {
  roadieEngagementOutcomeSchema,
  roadieEvidenceSchema,
  roadieTripImpactReportSchema,
} from "@tap-examples/roadie-contract/zod";
import type {
  PutTripRequest,
  RoadieTimelineItem,
  RoadieTrip,
} from "@tap-examples/roadie-contract";

type TripRow = {
  trip_id: string;
  workspace_id: string;
  owner_user_id: string;
  request_id: string;
  title: string;
  purpose: RoadieTrip["purpose"];
  location: string | null;
  impact_report_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

type ItineraryItemRow = {
  item_id: string;
  trip_id: string;
  title: string;
  start_at_ms: number;
  time_zone: string;
  kind: RoadieTimelineItem["kind"];
  engagement_type: RoadieTimelineItem["engagementType"] | null;
  evidence_json: string;
  outcome_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

async function parseJson(value: string): Promise<unknown> {
  return await new Response(value, {
    headers: { "Content-Type": "application/json" },
  }).json();
}

async function toTimelineItem(row: ItineraryItemRow): Promise<RoadieTimelineItem> {
  return {
    itemId: row.item_id,
    title: row.title,
    startAtMs: row.start_at_ms,
    timeZone: row.time_zone,
    kind: row.kind,
    ...(row.engagement_type ? { engagementType: row.engagement_type } : {}),
    evidence: roadieEvidenceSchema.array().parse(await parseJson(row.evidence_json)),
    ...(row.outcome_json
      ? { outcome: roadieEngagementOutcomeSchema.parse(await parseJson(row.outcome_json)) }
      : {}),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

async function toTrip(row: TripRow, timeline: RoadieTimelineItem[]): Promise<RoadieTrip> {
  return {
    tripId: row.trip_id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    purpose: row.purpose,
    ...(row.location ? { location: row.location } : {}),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    timeline,
    ...(row.impact_report_json
      ? {
          impactReport: roadieTripImpactReportSchema.parse(
            await parseJson(row.impact_report_json),
          ),
        }
      : {}),
  };
}

export async function listTrips(
  db: D1Database,
  workspaceId: string,
  ownerUserId?: string,
): Promise<RoadieTrip[]> {
  const tripStatement = ownerUserId
    ? db
        .prepare(
          `SELECT * FROM roadie_trips
           WHERE workspace_id = ?1 AND owner_user_id = ?2
           ORDER BY updated_at_ms DESC, trip_id DESC`,
        )
        .bind(workspaceId, ownerUserId)
    : db
        .prepare(
          `SELECT * FROM roadie_trips
           WHERE workspace_id = ?1
           ORDER BY updated_at_ms DESC, trip_id DESC`,
        )
        .bind(workspaceId);
  const [tripResult, itemResult] = await Promise.all([
    tripStatement.all<TripRow>(),
    db
      .prepare(
        `SELECT * FROM roadie_itinerary_items
         WHERE workspace_id = ?1
         ORDER BY start_at_ms ASC, item_id ASC`,
      )
      .bind(workspaceId)
      .all<ItineraryItemRow>(),
  ]);
  const itemsByTrip = new Map<string, RoadieTimelineItem[]>();
  for (const row of itemResult.results) {
    const items = itemsByTrip.get(row.trip_id) ?? [];
    items.push(await toTimelineItem(row));
    itemsByTrip.set(row.trip_id, items);
  }
  return await Promise.all(
    tripResult.results.map((row) => toTrip(row, itemsByTrip.get(row.trip_id) ?? [])),
  );
}

export async function tripOwner(
  db: D1Database,
  workspaceId: string,
  tripId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT owner_user_id FROM roadie_trips
       WHERE workspace_id = ?1 AND trip_id = ?2`,
    )
    .bind(workspaceId, tripId)
    .first<{ owner_user_id: string }>();
  return row?.owner_user_id ?? null;
}

export async function putTrip(
  db: D1Database,
  input: PutTripRequest,
  ownerUserId: string,
): Promise<RoadieTrip> {
  if (!input.trip) throw new Error("Roadie trip is required.");
  const trip = {
    ...input.trip,
    workspaceId: input.workspaceId,
    ownerUserId,
  };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO roadie_trips (
           trip_id, workspace_id, owner_user_id, request_id, title, purpose,
           location, impact_report_json, created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT (workspace_id, trip_id) DO UPDATE SET
           title = excluded.title,
           purpose = excluded.purpose,
           location = excluded.location,
           impact_report_json = excluded.impact_report_json,
           updated_at_ms = excluded.updated_at_ms`,
      )
      .bind(
        trip.tripId,
        input.workspaceId,
        ownerUserId,
        input.requestId,
        trip.title,
        trip.purpose,
        trip.location ?? null,
        trip.impactReport ? JSON.stringify(trip.impactReport) : null,
        trip.createdAtMs,
        trip.updatedAtMs,
      ),
    db
      .prepare(
        "DELETE FROM roadie_itinerary_items WHERE workspace_id = ?1 AND trip_id = ?2",
      )
      .bind(input.workspaceId, trip.tripId),
  ];
  for (const item of trip.timeline) {
    statements.push(
      db
        .prepare(
          `INSERT INTO roadie_itinerary_items (
             item_id, trip_id, workspace_id, title, start_at_ms, time_zone, kind,
             engagement_type, evidence_json, outcome_json, created_at_ms, updated_at_ms
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        .bind(
          item.itemId,
          trip.tripId,
          input.workspaceId,
          item.title,
          item.startAtMs,
          item.timeZone,
          item.kind,
          item.engagementType ?? null,
          JSON.stringify(item.evidence),
          item.outcome ? JSON.stringify(item.outcome) : null,
          item.createdAtMs,
          item.updatedAtMs,
        ),
    );
  }
  await db.batch(statements);
  return trip;
}

export async function deleteTrip(
  db: D1Database,
  workspaceId: string,
  tripId: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "DELETE FROM roadie_itinerary_items WHERE workspace_id = ?1 AND trip_id = ?2",
      )
      .bind(workspaceId, tripId),
    db
      .prepare("DELETE FROM roadie_trips WHERE workspace_id = ?1 AND trip_id = ?2")
      .bind(workspaceId, tripId),
  ]);
}
