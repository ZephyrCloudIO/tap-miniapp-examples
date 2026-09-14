-- Durable, at-least-once transactional email delivery for public bookings.
--
-- The outbox intentionally contains no management bearer token or management
-- URL. Those are derived only while rendering a leased message. Delivery
-- errors are reduced to bounded codes; provider error messages are never
-- persisted because they can contain recipient or message data.

CREATE TABLE public_booking_email_outbox (
  outbox_id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  booking_reference TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'booking-confirmed',
    'approval-requested',
    'approval-approved',
    'approval-declined',
    'approval-expired',
    'booking-cancelled',
    'booking-rescheduled'
  )),
  recipient_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  organizer_name TEXT NOT NULL,
  event_title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  previous_start_at TEXT,
  previous_end_at TEXT,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'leased', 'delivered', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count BETWEEN 0 AND 16),
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  dead_at TEXT,
  UNIQUE (booking_reference, event_key),
  FOREIGN KEY (booking_reference)
    REFERENCES public_booking_management_credentials (booking_reference)
    ON DELETE RESTRICT,
  CHECK (length(outbox_id) = 36),
  CHECK (length(event_key) BETWEEN 8 AND 255),
  CHECK (length(booking_reference) BETWEEN 16 AND 128),
  CHECK (length(workspace_id) BETWEEN 1 AND 255),
  CHECK (length(principal_id) BETWEEN 1 AND 255),
  CHECK (length(recipient_name) BETWEEN 1 AND 160),
  CHECK (length(recipient_email) BETWEEN 3 AND 320),
  CHECK (length(organizer_name) BETWEEN 1 AND 160),
  CHECK (length(event_title) BETWEEN 1 AND 200),
  CHECK (length(start_at) BETWEEN 20 AND 40),
  CHECK (length(end_at) BETWEEN 20 AND 40),
  CHECK (length(time_zone) BETWEEN 1 AND 255),
  CHECK (
    (kind = 'booking-rescheduled' AND
      previous_start_at IS NOT NULL AND previous_end_at IS NOT NULL) OR
    (kind <> 'booking-rescheduled' AND
      previous_start_at IS NULL AND previous_end_at IS NULL)
  ),
  CHECK (lease_token IS NULL OR length(lease_token) = 36),
  CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 128),
  CHECK (
    (state = 'queued' AND lease_token IS NULL AND lease_until IS NULL AND
      delivered_at IS NULL AND dead_at IS NULL) OR
    (state = 'leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL AND
      delivered_at IS NULL AND dead_at IS NULL) OR
    (state = 'delivered' AND lease_token IS NULL AND lease_until IS NULL AND
      delivered_at IS NOT NULL AND dead_at IS NULL) OR
    (state = 'dead' AND lease_token IS NULL AND lease_until IS NULL AND
      delivered_at IS NULL AND dead_at IS NOT NULL)
  )
);

CREATE INDEX public_booking_email_outbox_due
  ON public_booking_email_outbox (
    state,
    next_attempt_at,
    created_at,
    outbox_id
  );

CREATE INDEX public_booking_email_outbox_expired_leases
  ON public_booking_email_outbox (
    state,
    lease_until,
    outbox_id
  );

CREATE INDEX public_booking_email_outbox_booking
  ON public_booking_email_outbox (
    booking_reference,
    created_at,
    outbox_id
  );
