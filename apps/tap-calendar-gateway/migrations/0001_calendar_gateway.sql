CREATE TABLE calendar_connections (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'icloud', 'caldav', 'exchange', 'ics')),
  mode TEXT NOT NULL CHECK (mode IN ('local', 'oauth', 'credentials', 'subscription')),
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'connected', 'attention', 'read-only')),
  credential_ciphertext TEXT,
  token_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_synced_at TEXT,
  CHECK (length(id) BETWEEN 1 AND 255),
  CHECK (length(workspace_id) BETWEEN 1 AND 255),
  CHECK (length(label) BETWEEN 1 AND 255)
);

CREATE UNIQUE INDEX calendar_connections_workspace_id
  ON calendar_connections (workspace_id, id);

CREATE INDEX calendar_connections_workspace_updated
  ON calendar_connections (workspace_id, updated_at DESC, id);

CREATE TABLE provider_calendars (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  provider_calendar_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'writer', 'reader', 'free-busy')),
  writable INTEGER NOT NULL CHECK (writable IN (0, 1)),
  freshness TEXT NOT NULL CHECK (freshness IN ('live', 'delayed', 'stale')),
  is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
  raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(id) BETWEEN 1 AND 255),
  CHECK (length(provider_calendar_id) BETWEEN 1 AND 2048),
  CHECK (length(name) BETWEEN 1 AND 255),
  CHECK (length(color) BETWEEN 4 AND 32),
  UNIQUE (connection_id, provider_calendar_id)
);

CREATE INDEX provider_calendars_connection
  ON provider_calendars (connection_id, name, id);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  verifier_ciphertext TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX oauth_states_expiry ON oauth_states (expires_at);
