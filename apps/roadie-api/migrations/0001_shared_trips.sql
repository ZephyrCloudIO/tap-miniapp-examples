CREATE TABLE roadie_trips (
  trip_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  title TEXT NOT NULL,
  purpose TEXT NOT NULL,
  location TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (workspace_id, owner_user_id, request_id)
);

CREATE INDEX idx_roadie_trips_workspace_updated
  ON roadie_trips (workspace_id, updated_at_ms DESC, trip_id DESC);

CREATE INDEX idx_roadie_trips_workspace_owner_updated
  ON roadie_trips (workspace_id, owner_user_id, updated_at_ms DESC, trip_id DESC);
