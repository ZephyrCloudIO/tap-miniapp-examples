CREATE TABLE webhook_events (
  message_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT,
  received_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  CHECK (length(message_id) BETWEEN 1 AND 255),
  CHECK (length(workspace_id) BETWEEN 1 AND 255),
  CHECK (length(event_type) BETWEEN 1 AND 255)
);

CREATE INDEX webhook_events_workspace_received
  ON webhook_events (workspace_id, received_at, message_id);
