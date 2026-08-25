ALTER TABLE provider_events
  ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(payload_json));

ALTER TABLE provider_events
  ADD COLUMN dispatch_pending INTEGER NOT NULL DEFAULT 1
  CHECK (dispatch_pending IN (0, 1));

CREATE INDEX provider_events_dispatch
  ON provider_events (dispatch_pending, state, next_attempt_at, updated_at);
