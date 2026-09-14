-- Durable state for anonymous public-booking mutations.
--
-- The public request ID is scoped to the canonical TAP owner. Slot proof hashes
-- are single-use inside that same scope. Management credentials store only a
-- SHA-256 token hash; the bearer token is deterministically derived from a
-- Worker secret so an ambiguous retry never requires plaintext token storage.

CREATE TABLE public_booking_attempts (
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  provider_operation_id TEXT NOT NULL,
  booking_reference TEXT NOT NULL UNIQUE,
  revision_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  approval_expires_at TEXT,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'uncertain', 'committed', 'rejected')),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  rejection_code TEXT CHECK (
    rejection_code IS NULL OR rejection_code = 'slot_conflict'
  ),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, principal_id, idempotency_key),
  UNIQUE (workspace_id, principal_id, provider_operation_id),
  CHECK (length(workspace_id) BETWEEN 1 AND 255),
  CHECK (length(principal_id) BETWEEN 1 AND 255),
  CHECK (length(idempotency_key) BETWEEN 16 AND 255),
  CHECK (length(request_hash) BETWEEN 16 AND 128),
  CHECK (length(provider_operation_id) BETWEEN 16 AND 255),
  CHECK (length(booking_reference) BETWEEN 16 AND 128),
  CHECK (length(revision_id) BETWEEN 8 AND 255),
  CHECK (length(start_at) BETWEEN 20 AND 40),
  CHECK (length(end_at) BETWEEN 20 AND 40),
  CHECK (length(guest_name) BETWEEN 1 AND 160),
  CHECK (length(guest_email) BETWEEN 3 AND 320),
  CHECK (
    approval_expires_at IS NULL OR
    length(approval_expires_at) BETWEEN 20 AND 40
  ),
  CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 128)
);

CREATE INDEX public_booking_attempts_owner_state
  ON public_booking_attempts (
    workspace_id,
    principal_id,
    state,
    updated_at DESC,
    idempotency_key
  );

CREATE TABLE public_booking_slot_proof_uses (
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  slot_proof_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, principal_id, slot_proof_fingerprint),
  FOREIGN KEY (workspace_id, principal_id, idempotency_key)
    REFERENCES public_booking_attempts (
      workspace_id,
      principal_id,
      idempotency_key
    ) ON DELETE CASCADE,
  CHECK (length(slot_proof_fingerprint) BETWEEN 16 AND 128)
);

CREATE INDEX public_booking_slot_proof_uses_attempt
  ON public_booking_slot_proof_uses (
    workspace_id,
    principal_id,
    idempotency_key,
    created_at
  );

CREATE TABLE public_booking_management_credentials (
  booking_reference TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1 CHECK (token_version = 1),
  token_hash TEXT NOT NULL UNIQUE,
  page_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  provider_booking_id TEXT NOT NULL,
  provider_operation_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  approval_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'rescheduled', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (booking_reference)
    REFERENCES public_booking_attempts (booking_reference) ON DELETE RESTRICT,
  UNIQUE (workspace_id, principal_id, provider_operation_id),
  CHECK (length(token_hash) BETWEEN 32 AND 128),
  CHECK (length(page_id) BETWEEN 8 AND 255),
  CHECK (length(revision_id) BETWEEN 8 AND 255),
  CHECK (length(provider_booking_id) BETWEEN 1 AND 2048),
  CHECK (length(provider_operation_id) BETWEEN 16 AND 255),
  CHECK (length(guest_name) BETWEEN 1 AND 160),
  CHECK (length(guest_email) BETWEEN 3 AND 320),
  CHECK (
    approval_expires_at IS NULL OR
    length(approval_expires_at) BETWEEN 20 AND 40
  )
);

CREATE INDEX public_booking_management_credentials_owner_status
  ON public_booking_management_credentials (
    workspace_id,
    principal_id,
    status,
    updated_at DESC,
    booking_reference
  );

-- This lease is a Worker-level serialization aid around the complete public
-- booking callback. Database uniqueness and the existing provider-calendar
-- commit locks remain the authoritative correctness fences if a lease expires
-- while an upstream call is ambiguous.
CREATE TABLE public_booking_owner_leases (
  coordination_key TEXT PRIMARY KEY,
  lease_token TEXT,
  lease_until TEXT,
  updated_at TEXT NOT NULL,
  CHECK (length(coordination_key) BETWEEN 16 AND 255),
  CHECK (lease_token IS NULL OR length(lease_token) BETWEEN 16 AND 128),
  CHECK (
    (lease_token IS NULL AND lease_until IS NULL) OR
    (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  )
);

CREATE INDEX public_booking_owner_leases_expiration
  ON public_booking_owner_leases (lease_until, coordination_key);
