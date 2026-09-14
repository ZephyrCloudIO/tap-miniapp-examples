-- Bind every provider credential and provider mutation to one canonical TAP
-- human principal. Existing rows stay deliberately unclaimed; the local
-- gateway can assign them only when LEGACY_OWNER_PRINCIPAL_ID explicitly
-- matches the trusted X-TAP-Principal-Id supplied by the TAP surface.
ALTER TABLE calendar_connections ADD COLUMN principal_id TEXT;
ALTER TABLE oauth_states ADD COLUMN principal_id TEXT;
ALTER TABLE availability_confirmations ADD COLUMN principal_id TEXT;
ALTER TABLE provider_booking_commits ADD COLUMN principal_id TEXT;
ALTER TABLE provider_booking_commit_locks ADD COLUMN principal_id TEXT;
ALTER TABLE provider_booking_resolutions ADD COLUMN principal_id TEXT;

CREATE INDEX calendar_connections_principal_updated
  ON calendar_connections (workspace_id, principal_id, updated_at DESC, id);

CREATE INDEX oauth_states_principal
  ON oauth_states (workspace_id, principal_id, expires_at);

CREATE INDEX availability_confirmations_principal
  ON availability_confirmations (workspace_id, principal_id, idempotency_key);

CREATE INDEX provider_booking_commits_principal
  ON provider_booking_commits (workspace_id, principal_id, idempotency_key);

CREATE INDEX provider_booking_commit_locks_principal
  ON provider_booking_commit_locks (
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
