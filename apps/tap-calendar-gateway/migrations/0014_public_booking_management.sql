-- Guest management lifecycle for public bookings.
--
-- Bearer credentials remain hash-only.  The guest-safe snapshot and provider
-- routing data are copied onto the credential so cancellation still works after
-- a booking page is unpublished.  Rescheduling uses the current publication,
-- but never changes provider ownership or the destination calendar.

ALTER TABLE public_booking_management_credentials
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

ALTER TABLE public_booking_management_credentials
  ADD COLUMN booking_status TEXT NOT NULL DEFAULT 'confirmed'
  CHECK (booking_status IN ('confirmed', 'pending', 'declined', 'expired', 'cancelled'));

ALTER TABLE public_booking_management_credentials
  ADD COLUMN destination_calendar_id TEXT;

ALTER TABLE public_booking_management_credentials
  ADD COLUMN organizer_name TEXT NOT NULL DEFAULT 'TAP organizer';

ALTER TABLE public_booking_management_credentials
  ADD COLUMN event_title TEXT NOT NULL DEFAULT 'Scheduled meeting';

ALTER TABLE public_booking_management_credentials
  ADD COLUMN location_kind TEXT NOT NULL DEFAULT 'custom'
  CHECK (location_kind IN ('google-meet', 'phone', 'in-person', 'custom'));

ALTER TABLE public_booking_management_credentials
  ADD COLUMN location_label TEXT NOT NULL DEFAULT 'Details provided on confirmation';

ALTER TABLE public_booking_management_credentials
  ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE public_booking_management_credentials
  ADD COLUMN cancelled_at TEXT;

-- Backfill routing and approval state for credentials created before this
-- migration.  New writes always supply these values explicitly.
UPDATE public_booking_management_credentials
   SET destination_calendar_id = (
     SELECT commits.destination_calendar_id
       FROM provider_booking_commits AS commits
      WHERE commits.workspace_id = public_booking_management_credentials.workspace_id
        AND commits.principal_id = public_booking_management_credentials.principal_id
        AND commits.idempotency_key = public_booking_management_credentials.provider_operation_id
      LIMIT 1
   )
 WHERE destination_calendar_id IS NULL;

UPDATE public_booking_management_credentials
   SET booking_status = 'pending'
 WHERE approval_expires_at IS NOT NULL
   AND status = 'active';

UPDATE public_booking_management_credentials
   SET booking_status = 'cancelled'
 WHERE status IN ('cancelled', 'revoked');

CREATE INDEX public_booking_management_credentials_provider_projection
  ON public_booking_management_credentials (
    workspace_id,
    principal_id,
    provider_operation_id,
    status,
    start_at,
    end_at
  );

CREATE INDEX public_booking_management_credentials_pending_expiration
  ON public_booking_management_credentials (
    approval_expires_at,
    workspace_id,
    principal_id,
    provider_operation_id
  )
  WHERE status = 'active' AND booking_status = 'pending';

CREATE TABLE public_booking_management_mutations (
  booking_reference TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('cancel', 'reschedule')),
  expected_version INTEGER NOT NULL CHECK (expected_version >= 1),
  page_revision_id TEXT,
  from_start_at TEXT NOT NULL,
  from_end_at TEXT NOT NULL,
  to_start_at TEXT,
  to_end_at TEXT,
  conflict_calendar_ids_json TEXT
    CHECK (conflict_calendar_ids_json IS NULL OR json_valid(conflict_calendar_ids_json)),
  conflict_start_at TEXT,
  conflict_end_at TEXT,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'uncertain', 'committed', 'rejected')),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  rejection_code TEXT CHECK (
    rejection_code IS NULL OR
    rejection_code IN ('slot_conflict', 'provider_mismatch')
  ),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (booking_reference, request_id),
  FOREIGN KEY (booking_reference)
    REFERENCES public_booking_management_credentials (booking_reference)
    ON DELETE RESTRICT,
  CHECK (length(request_id) = 36),
  CHECK (length(request_hash) BETWEEN 16 AND 128),
  CHECK (length(operation_id) BETWEEN 16 AND 128),
  CHECK (length(from_start_at) BETWEEN 20 AND 40),
  CHECK (length(from_end_at) BETWEEN 20 AND 40),
  CHECK (
    (kind = 'cancel' AND page_revision_id IS NULL AND
      to_start_at IS NULL AND to_end_at IS NULL AND
      conflict_calendar_ids_json IS NULL AND conflict_start_at IS NULL AND conflict_end_at IS NULL) OR
    (kind = 'reschedule' AND page_revision_id IS NOT NULL AND
      to_start_at IS NOT NULL AND to_end_at IS NOT NULL AND
      conflict_calendar_ids_json IS NOT NULL AND
      conflict_start_at IS NOT NULL AND conflict_end_at IS NOT NULL)
  ),
  CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 128)
);

-- At most one provider outcome may be unresolved for a booking.  Exact retries
-- address the same row through the primary key; unrelated mutations fail closed.
CREATE UNIQUE INDEX public_booking_management_mutations_one_open
  ON public_booking_management_mutations (booking_reference)
  WHERE state IN ('pending', 'uncertain');

CREATE INDEX public_booking_management_mutations_recovery
  ON public_booking_management_mutations (
    state,
    updated_at,
    booking_reference,
    request_id
  );
