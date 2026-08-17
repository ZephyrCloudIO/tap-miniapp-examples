CREATE TABLE calendar_exclusions (
  workspace_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  provider_calendar_id TEXT NOT NULL,
  excluded_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, connection_id, provider_calendar_id),
  UNIQUE (workspace_id, connection_id, calendar_id),
  CHECK (length(workspace_id) BETWEEN 1 AND 255),
  CHECK (length(connection_id) BETWEEN 1 AND 255),
  CHECK (length(calendar_id) BETWEEN 1 AND 255),
  CHECK (length(provider_calendar_id) BETWEEN 1 AND 2048)
);

CREATE INDEX calendar_exclusions_connection
  ON calendar_exclusions (workspace_id, connection_id);
