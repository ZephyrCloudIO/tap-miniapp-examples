ALTER TABLE roadie_trips ADD COLUMN impact_report_json TEXT;

CREATE TABLE roadie_itinerary_items (
  item_id TEXT PRIMARY KEY NOT NULL,
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
  FOREIGN KEY (trip_id) REFERENCES roadie_trips (trip_id) ON DELETE CASCADE
);

CREATE INDEX idx_roadie_itinerary_trip_start
  ON roadie_itinerary_items (workspace_id, trip_id, start_at_ms, item_id);
