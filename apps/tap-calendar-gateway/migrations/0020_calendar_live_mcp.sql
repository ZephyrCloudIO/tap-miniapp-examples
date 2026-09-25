CREATE TABLE calendar_mcp_configuration (
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 0),
  configuration_json TEXT NOT NULL CHECK (json_valid(configuration_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, principal_id)
);

CREATE TABLE calendar_mcp_grants (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX calendar_mcp_grants_owner ON calendar_mcp_grants(workspace_id, principal_id, revoked_at);

CREATE TABLE calendar_mcp_authorizations (
  session_hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  client_name TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  grant_id TEXT REFERENCES calendar_mcp_grants(id),
  consumed_at TEXT
);
CREATE INDEX calendar_mcp_authorizations_expiry ON calendar_mcp_authorizations(expires_at);

CREATE INDEX provider_booking_commits_mcp_event
  ON provider_booking_commits(workspace_id, principal_id, destination_calendar_id, provider_event_id);
