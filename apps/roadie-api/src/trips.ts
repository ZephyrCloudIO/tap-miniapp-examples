import type { CreateTripRequest, RoadieTrip } from "@tap-examples/roadie-contract";

type TripRow = {
  trip_id: string;
  workspace_id: string;
  owner_user_id: string;
  request_id: string;
  title: string;
  purpose: RoadieTrip["purpose"];
  location: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

function toTrip(row: TripRow): RoadieTrip {
  return {
    tripId: row.trip_id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    purpose: row.purpose,
    ...(row.location ? { location: row.location } : {}),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

export async function listTrips(
  db: D1Database,
  workspaceId: string,
  ownerUserId?: string,
): Promise<RoadieTrip[]> {
  const statement = ownerUserId
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
  const result = await statement.all<TripRow>();
  return result.results.map(toTrip);
}

export async function createTrip(
  db: D1Database,
  input: CreateTripRequest,
  ownerUserId: string,
  nowMs: number,
  tripId: string,
): Promise<RoadieTrip> {
  await db
    .prepare(
      `INSERT INTO roadie_trips (
         trip_id, workspace_id, owner_user_id, request_id, title, purpose,
         location, created_at_ms, updated_at_ms
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT (workspace_id, owner_user_id, request_id) DO NOTHING`,
    )
    .bind(
      tripId,
      input.workspaceId,
      ownerUserId,
      input.requestId,
      input.title,
      input.purpose,
      input.location ?? null,
      nowMs,
    )
    .run();

  const row = await db
    .prepare(
      `SELECT * FROM roadie_trips
       WHERE workspace_id = ?1 AND owner_user_id = ?2 AND request_id = ?3`,
    )
    .bind(input.workspaceId, ownerUserId, input.requestId)
    .first<TripRow>();
  if (!row) throw new Error("Roadie trip write did not persist.");
  return toTrip(row);
}
