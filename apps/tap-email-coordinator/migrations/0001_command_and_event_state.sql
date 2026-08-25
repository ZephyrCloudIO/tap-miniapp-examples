CREATE TABLE google_accounts (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  google_subject TEXT NOT NULL,
  connection_state TEXT NOT NULL DEFAULT 'active'
    CHECK (connection_state IN ('active', 'reauthorization_required', 'revoked')),
  coverage_state TEXT NOT NULL DEFAULT 'backfilling'
    CHECK (coverage_state IN ('current', 'backfilling', 'stale', 'repairing', 'blocked')),
  newest_history_id TEXT,
  backfill_complete_through TEXT,
  unresolved_failures INTEGER NOT NULL DEFAULT 0 CHECK (unresolved_failures >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id),
  UNIQUE (profile_id, google_subject),
  CHECK (length(profile_id) BETWEEN 1 AND 256),
  CHECK (length(account_id) BETWEEN 1 AND 256)
);

CREATE TABLE mail_commands (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  thread_id TEXT,
  expected_provider_revision TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  state TEXT NOT NULL
    CHECK (state IN ('accepted', 'leased', 'provider_acknowledged', 'applied', 'retryable', 'uncertain', 'failed', 'cancelled')),
  dispatch_pending INTEGER NOT NULL DEFAULT 1 CHECK (dispatch_pending IN (0, 1)),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT,
  provider_acknowledged_at TEXT,
  provider_revision TEXT,
  error_code TEXT,
  client_created_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, command_id),
  UNIQUE (profile_id, idempotency_key),
  FOREIGN KEY (profile_id, account_id)
    REFERENCES google_accounts(profile_id, account_id)
    ON DELETE CASCADE
);

CREATE INDEX mail_commands_dispatch
  ON mail_commands (dispatch_pending, state, next_attempt_at, updated_at);
CREATE INDEX mail_commands_account_created
  ON mail_commands (profile_id, account_id, created_at, command_id);

CREATE TABLE provider_events (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  history_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'received'
    CHECK (state IN ('received', 'processing', 'applied', 'retryable', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT,
  resulting_history_id TEXT,
  error_code TEXT,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id, event_id),
  FOREIGN KEY (profile_id, account_id)
    REFERENCES google_accounts(profile_id, account_id)
    ON DELETE CASCADE
);

CREATE INDEX provider_events_work
  ON provider_events (state, next_attempt_at, updated_at);

CREATE TABLE coordinator_audit (
  audit_id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  account_id TEXT,
  operation TEXT NOT NULL,
  object_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  CHECK (length(operation) BETWEEN 1 AND 128),
  CHECK (length(outcome) BETWEEN 1 AND 128)
);

CREATE INDEX coordinator_audit_profile_time
  ON coordinator_audit (profile_id, occurred_at, audit_id);
