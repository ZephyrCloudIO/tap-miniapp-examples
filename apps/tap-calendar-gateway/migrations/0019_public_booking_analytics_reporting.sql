-- Keep attribution and confirmation history with the authoritative booking.
-- Older clients remain valid; their bookings have no visit attribution.
ALTER TABLE public_booking_attempts ADD COLUMN visit_id TEXT
  CHECK (visit_id IS NULL OR length(visit_id) = 36);
ALTER TABLE public_booking_attempts ADD COLUMN first_confirmed_at TEXT;

UPDATE public_booking_attempts AS attempts
   SET first_confirmed_at = attempts.updated_at
 WHERE attempts.state = 'committed' AND (
   json_extract(attempts.response_json, '$.status') = 'confirmed'
   OR EXISTS (SELECT 1 FROM public_booking_management_credentials m
               WHERE m.booking_reference = attempts.booking_reference AND m.booking_status = 'confirmed')
   OR EXISTS (SELECT 1 FROM provider_booking_commits c
               WHERE c.workspace_id = attempts.workspace_id AND c.principal_id = attempts.principal_id
                 AND c.idempotency_key = attempts.provider_operation_id AND c.resolution_status = 'approved')
   OR EXISTS (SELECT 1 FROM public_booking_email_outbox n
               WHERE n.booking_reference = attempts.booking_reference
                 AND n.workspace_id = attempts.workspace_id AND n.principal_id = attempts.principal_id
                 AND n.event_key = 'approval-approved:' || attempts.booking_reference)
 );

-- These triggers run in the same transaction as the booking/lifecycle write.
-- Cancellation, rescheduling, and provider cleanup never erase confirmation history.
CREATE TRIGGER public_booking_initial_confirmation_insert AFTER INSERT ON public_booking_attempts
WHEN NEW.state = 'committed' AND json_extract(NEW.response_json, '$.status') = 'confirmed'
BEGIN
  UPDATE public_booking_attempts SET first_confirmed_at = COALESCE(first_confirmed_at, NEW.updated_at)
   WHERE booking_reference = NEW.booking_reference;
END;

CREATE TRIGGER public_booking_initial_confirmation_update AFTER UPDATE OF state ON public_booking_attempts
WHEN NEW.state = 'committed' AND json_extract(NEW.response_json, '$.status') = 'confirmed'
BEGIN
  UPDATE public_booking_attempts SET first_confirmed_at = COALESCE(first_confirmed_at, NEW.updated_at)
   WHERE booking_reference = NEW.booking_reference;
END;

CREATE TRIGGER public_booking_approval_confirmation AFTER UPDATE OF booking_status ON public_booking_management_credentials
WHEN NEW.booking_status = 'confirmed'
BEGIN
  UPDATE public_booking_attempts SET first_confirmed_at = COALESCE(first_confirmed_at, NEW.updated_at)
   WHERE booking_reference = NEW.booking_reference
     AND workspace_id = NEW.workspace_id AND principal_id = NEW.principal_id;
END;

-- A verified submission proves the guest reached details even when the
-- separate browser analytics request was interrupted. Retries retain the
-- first claim's visit ID and cannot reattribute or duplicate a booking.
CREATE TRIGGER public_booking_submission_visit AFTER INSERT ON public_booking_attempts
WHEN NEW.visit_id IS NOT NULL
BEGIN
  INSERT INTO public_booking_funnel_visits (page_id, visit_id, slot_viewed, started, created_at)
  SELECT page_id, NEW.visit_id, 1, 1, NEW.created_at
    FROM public_booking_page_revisions WHERE id = NEW.revision_id
  ON CONFLICT (page_id, visit_id) DO UPDATE SET slot_viewed = 1, started = 1;
END;

CREATE INDEX public_booking_attempts_visit ON public_booking_attempts (revision_id, visit_id, state);

CREATE TABLE public_booking_analytics_coverage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  traffic_since TEXT NOT NULL,
  conversion_since TEXT NOT NULL
);
INSERT INTO public_booking_analytics_coverage (id, traffic_since, conversion_since)
SELECT 1, COALESCE(MIN(created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM public_booking_funnel_visits;
