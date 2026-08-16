import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "@rstest/core";

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  applyMigrations(database, [
    "0001_shared_trips.sql",
    "0002_complete_trips.sql",
    "0003_workspace_tenant_keys.sql",
  ]);
  return database;
}

function applyMigrations(database: DatabaseSync, migrations: readonly string[]): void {
  for (const migration of migrations) {
    database.exec(readFileSync(join(import.meta.dirname, "..", "migrations", migration), "utf8"));
  }
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

function insertItem(database: DatabaseSync, workspaceId: string, tripId: string, itemId: string) {
  database
    .prepare(
      `INSERT INTO roadie_itinerary_items (
        item_id, trip_id, workspace_id, title, start_at_ms, time_zone, kind,
        evidence_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      itemId,
      tripId,
      workspaceId,
      `Item for ${workspaceId}`,
      1,
      "UTC",
      "ROADIE_ITINERARY_ITEM_KIND_MEETING",
      "[]",
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

  it("preserves existing trips and itinerary items during the tenant-key migration", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyMigrations(database, ["0001_shared_trips.sql", "0002_complete_trips.sql"]);
    insertTrip(database, "workspace-a", "trip-a");
    insertItem(database, "workspace-a", "trip-a", "item-a");

    applyMigrations(database, ["0003_workspace_tenant_keys.sql"]);

    expect(database.prepare("SELECT COUNT(*) AS count FROM roadie_trips").get()).toEqual({
      count: 1,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM roadie_itinerary_items").get(),
    ).toEqual({ count: 1 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("cascades deletion only inside the selected workspace", () => {
    const database = migratedDatabase();
    insertTrip(database, "workspace-a", "shared-trip-id");
    insertTrip(database, "workspace-b", "shared-trip-id");
    insertItem(database, "workspace-a", "shared-trip-id", "shared-item-id");
    insertItem(database, "workspace-b", "shared-trip-id", "shared-item-id");

    database
      .prepare("DELETE FROM roadie_trips WHERE workspace_id = ? AND trip_id = ?")
      .run("workspace-a", "shared-trip-id");

    expect(
      database
        .prepare(
          `SELECT workspace_id, trip_id, item_id
           FROM roadie_itinerary_items
           ORDER BY workspace_id`,
        )
        .all(),
    ).toEqual([
      {
        workspace_id: "workspace-b",
        trip_id: "shared-trip-id",
        item_id: "shared-item-id",
      },
    ]);
  });
});
