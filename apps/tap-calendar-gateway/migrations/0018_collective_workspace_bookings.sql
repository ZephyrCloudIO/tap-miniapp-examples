-- Workspace ownership is separate from the legacy publication routing owner.
-- Preserve v1 rows/foreign keys and their owner_type compatibility field.
ALTER TABLE public_booking_profiles ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'individual'
  CHECK (owner_kind IN ('individual', 'workspace'));

CREATE TABLE calendar_booking_hosts (
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  policy_json TEXT NOT NULL CHECK (json_valid(policy_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, principal_id)
);

CREATE TABLE calendar_workspace_booking_profiles (
  workspace_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  published_version INTEGER,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE public_booking_workspace_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  actor_principal_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('publish', 'unpublish')),
  created_at TEXT NOT NULL
);

CREATE TABLE calendar_host_reservations (
  workspace_id TEXT NOT NULL,
  organizer_principal_id TEXT NOT NULL,
  booking_operation_id TEXT NOT NULL,
  host_principal_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL DEFAULT 'initial',
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
  buffer_before_ms INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_ms >= 0),
  buffer_after_ms INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_ms >= 0),
  host_snapshot_json TEXT CHECK (host_snapshot_json IS NULL OR json_valid(host_snapshot_json)),
  PRIMARY KEY (workspace_id, organizer_principal_id, booking_operation_id, host_principal_id, reservation_id)
);
CREATE INDEX calendar_host_reservations_host ON calendar_host_reservations(workspace_id, host_principal_id);

-- The canonical lifecycle decides whether a reservation is active. Never free
-- uncertain provider writes just because an HTTP request or lease expired.
CREATE VIEW calendar_active_host_reservations AS
SELECT r.workspace_id, r.organizer_principal_id, r.booking_operation_id,
       r.host_principal_id, r.reservation_id,
       CASE WHEN r.reservation_id = 'initial' THEN
         CAST(ROUND((julianday(COALESCE(m.start_at, c.start_at)) - 2440587.5) * 86400000) AS INTEGER) - r.buffer_before_ms
       ELSE r.start_ms END AS start_ms,
       CASE WHEN r.reservation_id = 'initial' THEN
         CAST(ROUND((julianday(COALESCE(m.end_at, c.end_at)) - 2440587.5) * 86400000) AS INTEGER) + r.buffer_after_ms
       ELSE r.end_ms END AS end_ms
FROM calendar_host_reservations r
JOIN provider_booking_commits c
  ON c.workspace_id = r.workspace_id AND c.principal_id = r.organizer_principal_id
 AND c.idempotency_key = r.booking_operation_id
LEFT JOIN public_booking_management_credentials m
  ON m.workspace_id = c.workspace_id AND m.principal_id = c.principal_id
 AND m.provider_operation_id = c.idempotency_key
LEFT JOIN public_booking_management_mutations mutation ON mutation.operation_id = r.reservation_id AND mutation.booking_reference = m.booking_reference
WHERE c.state IN ('pending', 'committed')
  AND (c.booking_kind <> 'approval-hold' OR (COALESCE(c.resolution_status, '') <> 'declined' AND c.hold_expired_at IS NULL))
  AND (m.booking_reference IS NULL OR m.status = 'active')
  AND (r.reservation_id = 'initial' OR mutation.state IN ('pending', 'uncertain')
    OR (mutation.state = 'committed'
      AND CAST(ROUND((julianday(m.start_at) - 2440587.5) * 86400000) AS INTEGER) = r.start_ms + r.buffer_before_ms
      AND CAST(ROUND((julianday(m.end_at) - 2440587.5) * 86400000) AS INTEGER) = r.end_ms - r.buffer_after_ms));

-- Existing individual bookings also compete with new collective links.
INSERT INTO calendar_host_reservations
  (workspace_id, organizer_principal_id, booking_operation_id, host_principal_id, start_ms, end_ms, buffer_before_ms, buffer_after_ms)
SELECT workspace_id, principal_id, idempotency_key, principal_id,
       CAST(ROUND((julianday(start_at) - 2440587.5) * 86400000) AS INTEGER),
       CAST(ROUND((julianday(end_at) - 2440587.5) * 86400000) AS INTEGER),
       MAX(0, COALESCE(CAST(ROUND((julianday(start_at) - julianday(json_extract(request_json, '$.conflictTimeMin'))) * 86400000) AS INTEGER), 0)),
       MAX(0, COALESCE(CAST(ROUND((julianday(json_extract(request_json, '$.conflictTimeMax')) - julianday(end_at)) * 86400000) AS INTEGER), 0))
FROM provider_booking_commits
WHERE principal_id IS NOT NULL AND start_at IS NOT NULL AND end_at > start_at
  AND state IN ('pending', 'committed');

-- D1 executes a batch transactionally: one conflict rolls back the complete
-- host set. This fence applies across links, organizers, and booking surfaces.
CREATE TRIGGER calendar_host_reservation_no_overlap BEFORE INSERT ON calendar_host_reservations
WHEN EXISTS (
  SELECT 1 FROM calendar_active_host_reservations a
  WHERE a.workspace_id = NEW.workspace_id AND a.host_principal_id = NEW.host_principal_id
    AND a.start_ms < NEW.end_ms AND a.end_ms > NEW.start_ms
    AND NOT (a.organizer_principal_id = NEW.organizer_principal_id AND a.booking_operation_id = NEW.booking_operation_id)
)
BEGIN
  SELECT RAISE(ABORT, 'calendar_host_slot_conflict');
END;

-- Removing a provider calendar cascades its commit records. Preserve required
-- hosts' reservations while a collective booking is still in progress.
CREATE TRIGGER calendar_shared_booking_calendar_retention BEFORE DELETE ON provider_calendars
WHEN EXISTS (
  SELECT 1 FROM calendar_active_host_reservations a
  JOIN calendar_host_reservations r ON r.workspace_id = a.workspace_id
    AND r.organizer_principal_id = a.organizer_principal_id AND r.booking_operation_id = a.booking_operation_id
    AND r.host_principal_id = a.host_principal_id AND r.reservation_id = a.reservation_id
  JOIN provider_booking_commits c ON c.workspace_id = a.workspace_id
    AND c.principal_id = a.organizer_principal_id AND c.idempotency_key = a.booking_operation_id
  WHERE c.destination_calendar_id = OLD.id AND r.host_snapshot_json IS NOT NULL
    AND a.end_ms > CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT, 'calendar_shared_bookings_active');
END;
