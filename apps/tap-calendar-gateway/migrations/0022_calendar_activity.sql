-- Successful state transitions and their activity receipt commit atomically.
-- No backfill: historical records cannot establish when tracking was complete.
CREATE TABLE calendar_activity_coverage (
  id INTEGER PRIMARY KEY CHECK (id = 1), started_at TEXT NOT NULL
);
INSERT INTO calendar_activity_coverage VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE calendar_activity_events (
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  activity_id TEXT NOT NULL CHECK (activity_id IN (
    'meeting-scheduled', 'meeting-rescheduled', 'meeting-cancelled', 'work-block-created',
    'booking-received', 'booking-decision', 'booking-page', 'availability-updated'
  )),
  status_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, principal_id, event_key)
);
CREATE INDEX calendar_activity_owner_time ON calendar_activity_events(workspace_id, principal_id, occurred_at DESC);

CREATE TRIGGER calendar_activity_provider_commit AFTER UPDATE OF state ON provider_booking_commits
WHEN NEW.state = 'committed' AND OLD.state <> 'committed' AND NEW.principal_id IS NOT NULL
  AND NEW.booking_kind IN ('meeting', 'work-block')
  AND NOT EXISTS (SELECT 1 FROM public_booking_attempts a WHERE a.workspace_id = NEW.workspace_id
    AND a.principal_id = NEW.principal_id AND a.provider_operation_id = NEW.idempotency_key)
BEGIN
  INSERT OR IGNORE INTO calendar_activity_events VALUES (NEW.workspace_id, NEW.principal_id,
    'provider:' || NEW.idempotency_key,
    CASE NEW.booking_kind WHEN 'work-block' THEN 'work-block-created' ELSE 'meeting-scheduled' END,
    'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

-- Shared host policy saves are server-owned. Cosmetic changes and version-only
-- retries do not count as availability changes.
CREATE TRIGGER calendar_activity_host_created AFTER INSERT ON calendar_booking_hosts
WHEN NEW.enabled = 1
BEGIN
  INSERT OR IGNORE INTO calendar_activity_events VALUES (NEW.workspace_id, NEW.principal_id,
    'host-policy:' || NEW.version, 'availability-updated', 'saved', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
CREATE TRIGGER calendar_activity_host_updated AFTER UPDATE ON calendar_booking_hosts
WHEN OLD.enabled <> NEW.enabled
  OR json_remove(OLD.policy_json, '$.version', '$.displayName', '$.email')
    <> json_remove(NEW.policy_json, '$.version', '$.displayName', '$.email')
BEGIN
  INSERT OR IGNORE INTO calendar_activity_events VALUES (NEW.workspace_id, NEW.principal_id,
    'host-policy:' || NEW.version, 'availability-updated', 'saved', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER calendar_activity_booking_received AFTER UPDATE OF state ON public_booking_attempts
WHEN NEW.state = 'committed' AND OLD.state <> 'committed'
BEGIN
  INSERT OR IGNORE INTO calendar_activity_events VALUES (NEW.workspace_id, NEW.principal_id,
    'booking:' || NEW.idempotency_key, 'booking-received', json_extract(NEW.response_json, '$.status'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER calendar_activity_booking_decision AFTER UPDATE OF state ON provider_booking_resolutions
WHEN NEW.state = 'committed' AND OLD.state <> 'committed' AND NEW.principal_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO calendar_activity_events VALUES (NEW.workspace_id, NEW.principal_id,
    'decision:' || NEW.booking_idempotency_key, 'booking-decision',
    CASE NEW.decision WHEN 'approve' THEN 'approved' ELSE 'declined' END, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  -- An approved ad hoc hold becomes a meeting only after provider confirmation.
  INSERT OR IGNORE INTO calendar_activity_events
    SELECT NEW.workspace_id, NEW.principal_id, 'provider:' || NEW.booking_idempotency_key,
      'meeting-scheduled', 'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE NEW.decision = 'approve' AND NOT EXISTS (SELECT 1 FROM public_booking_attempts a
      WHERE a.workspace_id = NEW.workspace_id AND a.principal_id = NEW.principal_id
        AND a.provider_operation_id = NEW.booking_idempotency_key);
END;

CREATE TRIGGER calendar_activity_management AFTER UPDATE OF state ON public_booking_management_mutations
WHEN NEW.state = 'committed' AND OLD.state <> 'committed'
  AND (NEW.kind = 'cancel' OR NEW.from_start_at <> NEW.to_start_at OR NEW.from_end_at <> NEW.to_end_at)
BEGIN
  INSERT OR IGNORE INTO calendar_activity_events
    SELECT c.workspace_id, c.principal_id, 'management:' || NEW.operation_id,
      CASE NEW.kind WHEN 'cancel' THEN 'meeting-cancelled' ELSE 'meeting-rescheduled' END,
      'completed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM public_booking_management_credentials c WHERE c.booking_reference = NEW.booking_reference;
END;

-- Page revision changes are content based. Saving/publishing identical content
-- may advance a profile generation but does not create another activity.
-- Workspace publications are credited to the authenticated manager who saved
-- the serialized workspace definition, not to the synthetic workspace owner.
CREATE TRIGGER calendar_activity_page AFTER UPDATE OF status, current_revision_id ON public_booking_pages
WHEN (NEW.status = 'published' AND (OLD.status <> 'published' OR OLD.current_revision_id IS NOT NEW.current_revision_id))
  OR (NEW.status = 'unpublished' AND OLD.status = 'published')
BEGIN
  INSERT OR IGNORE INTO calendar_activity_events
    SELECT p.workspace_id,
      CASE WHEN p.owner_kind = 'workspace' THEN d.updated_by ELSE p.principal_id END,
      'page:' || NEW.id || ':' || p.publication_generation,
      'booking-page', CASE WHEN NEW.status = 'unpublished' THEN 'unpublished'
        WHEN OLD.status = 'published' THEN 'updated' ELSE 'published' END, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM public_booking_profiles p LEFT JOIN calendar_workspace_booking_profiles d ON d.workspace_id = p.workspace_id
    WHERE p.id = NEW.profile_id AND (p.owner_kind = 'individual' OR d.updated_by IS NOT NULL);
END;
