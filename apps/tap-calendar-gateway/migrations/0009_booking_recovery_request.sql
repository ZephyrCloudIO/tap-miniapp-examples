ALTER TABLE provider_booking_commits
  ADD COLUMN request_json TEXT CHECK (request_json IS NULL OR json_valid(request_json));
