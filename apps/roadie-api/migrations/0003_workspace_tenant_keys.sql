CREATE TABLE roadie_trips_workspace_scoped (
  trip_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  title TEXT NOT NULL,
  purpose TEXT NOT NULL,
  location TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  impact_report_json TEXT,
  PRIMARY KEY (workspace_id, trip_id),
  UNIQUE (workspace_id, owner_user_id, request_id)
);

INSERT INTO roadie_trips_workspace_scoped (
  trip_id, workspace_id, owner_user_id, request_id, title, purpose, location,
  created_at_ms, updated_at_ms, impact_report_json
)
SELECT
  trip_id, workspace_id, owner_user_id, request_id, title, purpose, location,
  created_at_ms, updated_at_ms, impact_report_json
FROM roadie_trips;

CREATE TABLE roadie_itinerary_items_workspace_scoped (
  item_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_at_ms INTEGER NOT NULL,
  time_zone TEXT NOT NULL,
  kind TEXT NOT NULL,
  engagement_type TEXT,
  evidence_json TEXT NOT NULL,
  outcome_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, trip_id, item_id),
  FOREIGN KEY (workspace_id, trip_id)
    REFERENCES roadie_trips_workspace_scoped (workspace_id, trip_id)
    ON DELETE CASCADE
);

INSERT INTO roadie_itinerary_items_workspace_scoped (
  item_id, trip_id, workspace_id, title, start_at_ms, time_zone, kind,
  engagement_type, evidence_json, outcome_json, created_at_ms, updated_at_ms
)
SELECT
  item_id, trip_id, workspace_id, title, start_at_ms, time_zone, kind,
  engagement_type, evidence_json, outcome_json, created_at_ms, updated_at_ms
FROM roadie_itinerary_items;

DROP TABLE roadie_itinerary_items;
DROP TABLE roadie_trips;

ALTER TABLE roadie_trips_workspace_scoped RENAME TO roadie_trips;
ALTER TABLE roadie_itinerary_items_workspace_scoped RENAME TO roadie_itinerary_items;

CREATE INDEX idx_roadie_trips_workspace_updated
  ON roadie_trips (workspace_id, updated_at_ms DESC, trip_id DESC);

CREATE INDEX idx_roadie_trips_workspace_owner_updated
  ON roadie_trips (workspace_id, owner_user_id, updated_at_ms DESC, trip_id DESC);

CREATE INDEX idx_roadie_itinerary_trip_start
  ON roadie_itinerary_items (workspace_id, trip_id, start_at_ms, item_id);
