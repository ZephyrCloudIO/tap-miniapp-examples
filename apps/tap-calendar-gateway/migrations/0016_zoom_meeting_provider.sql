-- Zoom is a conferencing provider, not a calendar source. Keep its OAuth
-- credentials separate from calendar_connections and bind every row to the
-- canonical TAP owner that initiated authorization.
CREATE TABLE meeting_provider_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'zoom'),
  mode TEXT NOT NULL CHECK (mode = 'oauth'),
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'connected', 'attention')),
  credential_ciphertext TEXT,
  token_expires_at TEXT,
  provider_account_id TEXT,
  provider_user_id TEXT,
  provider_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_verified_at TEXT,
  refresh_lease_token TEXT,
  refresh_lease_until TEXT,
  UNIQUE (workspace_id, principal_id, provider),
  UNIQUE (workspace_id, principal_id, id),
  CHECK (length(id) BETWEEN 1 AND 255),
  CHECK (length(workspace_id) BETWEEN 1 AND 255),
  CHECK (length(principal_id) BETWEEN 1 AND 255),
  CHECK (length(label) BETWEEN 1 AND 255),
  CHECK (provider_email IS NULL OR length(provider_email) BETWEEN 3 AND 320),
  CHECK (
    (refresh_lease_token IS NULL AND refresh_lease_until IS NULL) OR
    (refresh_lease_token IS NOT NULL AND refresh_lease_until IS NOT NULL)
  )
);

CREATE INDEX meeting_provider_connections_owner
  ON meeting_provider_connections (workspace_id, principal_id, provider, updated_at DESC);

CREATE TABLE meeting_provider_oauth_states (
  state_hash TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'zoom'),
  verifier_ciphertext TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id, principal_id, connection_id)
    REFERENCES meeting_provider_connections (workspace_id, principal_id, id)
    ON DELETE CASCADE,
  CHECK (length(state_hash) BETWEEN 32 AND 128),
  CHECK (length(redirect_uri) BETWEEN 12 AND 2048)
);

CREATE INDEX meeting_provider_oauth_states_expiration
  ON meeting_provider_oauth_states (expires_at, workspace_id, principal_id);

-- Zoom's create-meeting API has no documented idempotency key. This saga row
-- ensures TAP never repeats a create call whose result was ambiguous. Once a
-- meeting is recorded, Google Calendar writes and retries reuse the same URL.
CREATE TABLE zoom_meeting_operations (
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  booking_idempotency_key TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('creating', 'created', 'create_uncertain', 'deleted')),
  zoom_meeting_id TEXT,
  join_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, principal_id, booking_idempotency_key),
  FOREIGN KEY (workspace_id, principal_id, connection_id)
    REFERENCES meeting_provider_connections (workspace_id, principal_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, principal_id, booking_idempotency_key)
    REFERENCES provider_booking_commits (workspace_id, principal_id, idempotency_key)
    ON DELETE CASCADE,
  CHECK (length(request_hash) BETWEEN 32 AND 128),
  CHECK (
    (state = 'created' AND zoom_meeting_id IS NOT NULL AND join_url IS NOT NULL) OR
    (state = 'deleted' AND zoom_meeting_id IS NOT NULL AND join_url IS NULL) OR
    (state IN ('creating', 'create_uncertain') AND zoom_meeting_id IS NULL AND join_url IS NULL)
  )
);

CREATE INDEX zoom_meeting_operations_connection
  ON zoom_meeting_operations (connection_id, state, updated_at DESC);
