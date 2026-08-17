CREATE TABLE provider_booking_commits (
  workspace_id TEXT NOT NULL,
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
  PRIMARY KEY (workspace_id, idempotency_key),
  UNIQUE (workspace_id, destination_calendar_id, provider_event_id),
  CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  CHECK (length(request_hash) BETWEEN 1 AND 128),
  CHECK (length(provider_event_id) BETWEEN 5 AND 1024)
);

CREATE INDEX provider_booking_commits_destination_time
  ON provider_booking_commits (
    workspace_id,
    destination_calendar_id,
    start_at,
    end_at,
    state
  );

CREATE TABLE provider_booking_commit_locks (
  workspace_id TEXT NOT NULL,
  destination_calendar_id TEXT NOT NULL REFERENCES provider_calendars(id) ON DELETE CASCADE,
  lease_token TEXT,
  lease_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, destination_calendar_id)
);

CREATE INDEX provider_booking_commit_locks_expiration
  ON provider_booking_commit_locks (lease_until, workspace_id, destination_calendar_id);
