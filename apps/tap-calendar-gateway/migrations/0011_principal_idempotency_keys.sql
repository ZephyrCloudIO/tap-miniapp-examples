-- Principal is part of every idempotency and booking-lock identity. This lets
-- two TAP users in one workspace safely choose the same client key without
-- sharing or blocking one another's durable state.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE availability_confirmations_v2 (
  workspace_id TEXT NOT NULL,
  principal_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, principal_id, idempotency_key),
  CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  CHECK (length(request_hash) BETWEEN 1 AND 128)
);

INSERT INTO availability_confirmations_v2
SELECT workspace_id, principal_id, idempotency_key, request_hash, response_json, created_at
FROM availability_confirmations;

CREATE TABLE provider_booking_commits_v2 (
  workspace_id TEXT NOT NULL,
  principal_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  destination_calendar_id TEXT NOT NULL REFERENCES provider_calendars(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  booking_kind TEXT NOT NULL CHECK (booking_kind IN ('meeting', 'approval-hold', 'work-block')),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'committed', 'rejected')),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolution_status TEXT CHECK (resolution_status IS NULL OR resolution_status IN ('approved', 'declined')),
  conflict_calendar_ids_json TEXT CHECK (conflict_calendar_ids_json IS NULL OR json_valid(conflict_calendar_ids_json)),
  hold_expires_at TEXT,
  hold_expired_at TEXT,
  request_json TEXT CHECK (request_json IS NULL OR json_valid(request_json)),
  PRIMARY KEY (workspace_id, principal_id, idempotency_key),
  UNIQUE (workspace_id, principal_id, destination_calendar_id, provider_event_id),
  CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  CHECK (length(request_hash) BETWEEN 1 AND 128),
  CHECK (length(provider_event_id) BETWEEN 5 AND 1024)
);

INSERT INTO provider_booking_commits_v2
SELECT workspace_id, principal_id, idempotency_key, request_hash,
       destination_calendar_id, provider_event_id, booking_kind, start_at,
       end_at, state, response_json, last_error_code, created_at, updated_at,
       resolution_status, conflict_calendar_ids_json, hold_expires_at,
       hold_expired_at, request_json
FROM provider_booking_commits;

CREATE TABLE provider_booking_commit_locks_v2 (
  workspace_id TEXT NOT NULL,
  principal_id TEXT,
  destination_calendar_id TEXT NOT NULL REFERENCES provider_calendars(id) ON DELETE CASCADE,
  lease_token TEXT,
  lease_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, principal_id, destination_calendar_id)
);

INSERT INTO provider_booking_commit_locks_v2
SELECT workspace_id, principal_id, destination_calendar_id, lease_token,
       lease_until, updated_at
FROM provider_booking_commit_locks;

CREATE TABLE provider_booking_resolutions_v2 (
  workspace_id TEXT NOT NULL,
  principal_id TEXT,
  booking_idempotency_key TEXT NOT NULL,
  resolution_idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'decline')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'committed')),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, principal_id, booking_idempotency_key),
  UNIQUE (workspace_id, principal_id, resolution_idempotency_key),
  FOREIGN KEY (workspace_id, principal_id, booking_idempotency_key)
    REFERENCES provider_booking_commits_v2(workspace_id, principal_id, idempotency_key)
    ON DELETE CASCADE,
  CHECK (length(resolution_idempotency_key) BETWEEN 1 AND 255),
  CHECK (length(request_hash) BETWEEN 1 AND 128)
);

INSERT INTO provider_booking_resolutions_v2
SELECT workspace_id, principal_id, booking_idempotency_key,
       resolution_idempotency_key, request_hash, decision, state,
       response_json, last_error_code, created_at, updated_at
FROM provider_booking_resolutions;

DROP TABLE provider_booking_resolutions;
DROP TABLE provider_booking_commit_locks;
DROP TABLE provider_booking_commits;
DROP TABLE availability_confirmations;

ALTER TABLE provider_booking_commits_v2 RENAME TO provider_booking_commits;
ALTER TABLE provider_booking_commit_locks_v2 RENAME TO provider_booking_commit_locks;
ALTER TABLE provider_booking_resolutions_v2 RENAME TO provider_booking_resolutions;
ALTER TABLE availability_confirmations_v2 RENAME TO availability_confirmations;

CREATE INDEX availability_confirmations_principal
  ON availability_confirmations (workspace_id, principal_id, idempotency_key);

CREATE INDEX provider_booking_commits_principal
  ON provider_booking_commits (workspace_id, principal_id, idempotency_key);

CREATE INDEX provider_booking_commits_destination_time
  ON provider_booking_commits (
    workspace_id,
    principal_id,
    destination_calendar_id,
    start_at,
    end_at,
    state
  );

CREATE INDEX provider_booking_holds_expiring
  ON provider_booking_commits (
    booking_kind,
    state,
    resolution_status,
    hold_expired_at,
    hold_expires_at
  );

CREATE INDEX provider_booking_commit_locks_principal
  ON provider_booking_commit_locks (
    workspace_id,
    principal_id,
    destination_calendar_id
  );

CREATE INDEX provider_booking_commit_locks_expiration
  ON provider_booking_commit_locks (
    lease_until,
    workspace_id,
    principal_id,
    destination_calendar_id
  );

CREATE INDEX provider_booking_resolutions_principal
  ON provider_booking_resolutions (
    workspace_id,
    principal_id,
    booking_idempotency_key
  );
