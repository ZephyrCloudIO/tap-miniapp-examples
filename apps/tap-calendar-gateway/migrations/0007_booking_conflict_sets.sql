ALTER TABLE provider_booking_commits
  ADD COLUMN conflict_calendar_ids_json TEXT
  CHECK (conflict_calendar_ids_json IS NULL OR json_valid(conflict_calendar_ids_json));
