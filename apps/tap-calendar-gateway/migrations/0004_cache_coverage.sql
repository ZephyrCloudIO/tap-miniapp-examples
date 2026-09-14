ALTER TABLE calendar_sync_state ADD COLUMN cache_time_max TEXT;

CREATE INDEX calendar_sync_state_coverage
  ON calendar_sync_state (workspace_id, calendar_id, cache_time_min, cache_time_max);
