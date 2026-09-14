ALTER TABLE provider_booking_commits
  ADD COLUMN resolution_status TEXT
  CHECK (resolution_status IS NULL OR resolution_status IN ('approved', 'declined'));

CREATE TABLE provider_booking_resolutions (
  workspace_id TEXT NOT NULL,
  booking_idempotency_key TEXT NOT NULL,
  resolution_idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'decline')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'committed')),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, booking_idempotency_key),
  UNIQUE (workspace_id, resolution_idempotency_key),
  FOREIGN KEY (workspace_id, booking_idempotency_key)
    REFERENCES provider_booking_commits(workspace_id, idempotency_key)
    ON DELETE CASCADE,
  CHECK (length(resolution_idempotency_key) BETWEEN 1 AND 255),
  CHECK (length(request_hash) BETWEEN 1 AND 128)
);
