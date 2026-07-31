import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "@rstest/core";

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of [
    "0001_shared_trips.sql",
    "0002_complete_trips.sql",
    "0003_workspace_tenant_keys.sql",
  ]) {
    database.exec(readFileSync(join(import.meta.dirname, "..", "migrations", migration), "utf8"));
  }
  return database;
}

function insertTrip(database: DatabaseSync, workspaceId: string, tripId: string): void {
  database
    .prepare(
      `INSERT INTO roadie_trips (
        trip_id, workspace_id, owner_user_id, request_id, title, purpose,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tripId,
      workspaceId,
      `owner-${workspaceId}`,
      `request-${workspaceId}`,
      `Trip for ${workspaceId}`,
      "ROADIE_TRIP_PURPOSE_WORK",
      1,
      1,
    );
}

describe("Roadie D1 tenant keys", () => {
  it("allows the same client-selected trip ID in two workspaces", () => {
    const database = migratedDatabase();
    insertTrip(database, "workspace-a", "shared-trip-id");

    expect(() => insertTrip(database, "workspace-b", "shared-trip-id")).not.toThrow();

    const rows = database
      .prepare(
        `SELECT workspace_id, trip_id
         FROM roadie_trips
         WHERE trip_id = ?
         ORDER BY workspace_id`,
      )
      .all("shared-trip-id");
    expect(rows).toEqual([
      { workspace_id: "workspace-a", trip_id: "shared-trip-id" },
      { workspace_id: "workspace-b", trip_id: "shared-trip-id" },
    ]);
  });

  it("rejects an itinerary item whose workspace does not own the trip", () => {
    const database = migratedDatabase();
    insertTrip(database, "workspace-a", "trip-a");

    expect(() =>
      database
        .prepare(
          `INSERT INTO roadie_itinerary_items (
            item_id, trip_id, workspace_id, title, start_at_ms, time_zone, kind,
            evidence_json, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "item-a",
          "trip-a",
          "workspace-b",
          "Wrong workspace",
          1,
          "UTC",
          "ROADIE_ITINERARY_ITEM_KIND_MEETING",
          "[]",
          1,
          1,
        ),
    ).toThrow();
  });
});
