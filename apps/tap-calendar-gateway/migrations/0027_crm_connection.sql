-- Connect to CRM: one workspace credential plus a durable delivery queue.
--
-- The CRM address is not stored: it is the gateway's CRM_API_URL var, so one
-- place decides which CRM an environment may write to.
--
-- The bot key is a workspace credential, not a person's grant: bookings arrive
-- unattended and must keep working when the person who connected leaves. It is
-- encrypted with TOKEN_ENCRYPTION_KEY like the Zoom tokens, and disconnecting
-- deletes the row. Delivery rows hold the guest snapshot until the CRM accepts
-- it; they never hold the management link or token, and delivery errors are
-- reduced to bounded codes because response bodies can contain guest data.

CREATE TABLE crm_connections (
  workspace_id TEXT PRIMARY KEY,
  key_ciphertext TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('connected', 'attention')),
  status_reason TEXT CHECK (
    status_reason IS NULL OR status_reason IN ('invalid_key', 'missing_scope', 'unreachable')
  ),
  connected_by TEXT NOT NULL,
  -- Bookings changed before this moment are never sent; nothing is backfilled.
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_verified_at TEXT,
  last_delivered_at TEXT,
  CHECK (length(workspace_id) BETWEEN 1 AND 255),
  CHECK (length(connected_by) BETWEEN 1 AND 255),
  CHECK ((status = 'connected' AND status_reason IS NULL) OR status = 'attention')
);

CREATE TABLE crm_booking_deliveries (
  delivery_id TEXT PRIMARY KEY,
  booking_reference TEXT NOT NULL,
  event_key TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  booking_status TEXT NOT NULL CHECK (booking_status IN ('CONFIRMED', 'CANCELLED')),
  booking_version INTEGER NOT NULL CHECK (booking_version >= 1),
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'leased', 'delivered', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 16),
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  last_error_code TEXT,
  last_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  dead_at TEXT,
  UNIQUE (booking_reference, event_key),
  FOREIGN KEY (booking_reference)
    REFERENCES public_booking_management_credentials (booking_reference)
    ON DELETE RESTRICT,
  CHECK (length(delivery_id) = 36),
  CHECK (length(event_key) BETWEEN 8 AND 255),
  CHECK (length(booking_reference) BETWEEN 16 AND 128),
  CHECK (length(workspace_id) BETWEEN 1 AND 255),
  CHECK (lease_token IS NULL OR length(lease_token) = 36),
  CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 128),
  CHECK (last_request_id IS NULL OR length(last_request_id) BETWEEN 1 AND 128),
  CHECK (
    (state = 'queued' AND payload_json IS NOT NULL AND lease_token IS NULL AND
      lease_until IS NULL AND delivered_at IS NULL AND dead_at IS NULL) OR
    (state = 'leased' AND payload_json IS NOT NULL AND lease_token IS NOT NULL AND
      lease_until IS NOT NULL AND delivered_at IS NULL AND dead_at IS NULL) OR
    (state = 'delivered' AND payload_json IS NULL AND lease_token IS NULL AND
      lease_until IS NULL AND delivered_at IS NOT NULL AND dead_at IS NULL) OR
    (state = 'dead' AND payload_json IS NULL AND lease_token IS NULL AND
      lease_until IS NULL AND delivered_at IS NULL AND dead_at IS NOT NULL)
  )
);

CREATE INDEX crm_booking_deliveries_due
  ON crm_booking_deliveries (state, next_attempt_at, created_at, delivery_id);

CREATE INDEX crm_booking_deliveries_workspace
  ON crm_booking_deliveries (workspace_id, state);

CREATE INDEX crm_booking_deliveries_booking
  ON crm_booking_deliveries (booking_reference, booking_status);
