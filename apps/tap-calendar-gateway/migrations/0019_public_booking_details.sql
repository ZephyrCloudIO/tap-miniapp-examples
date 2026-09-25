-- Capture the original guest-supplied details with the idempotent booking claim.
-- Existing bookings retain their original request hashes and empty details.
ALTER TABLE public_booking_attempts
  ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(details_json) AND json_type(details_json) = 'object');
