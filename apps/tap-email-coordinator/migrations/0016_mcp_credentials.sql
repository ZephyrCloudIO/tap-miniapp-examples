-- One revocable, scoped MCP credential per profile. Plaintext is returned once.
CREATE TABLE email_mcp_credentials (
  profile_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  sender_user_id TEXT,
  sender_workspace_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX mail_commands_activity_cursor ON mail_commands(profile_id, updated_at, command_id);
CREATE INDEX coordinator_audit_email_views ON coordinator_audit(profile_id, operation, occurred_at, audit_id);
