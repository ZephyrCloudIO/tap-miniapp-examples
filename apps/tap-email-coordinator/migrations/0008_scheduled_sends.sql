CREATE TABLE scheduled_sends (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  schedule_command_id TEXT NOT NULL,
  thread_id TEXT,
  draft_key TEXT NOT NULL,
  draft_payload_json TEXT NOT NULL CHECK (json_valid(draft_payload_json)),
  due_at TEXT NOT NULL,
  cancel_if_reply INTEGER NOT NULL CHECK (cancel_if_reply IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'enqueued', 'cancelled', 'sent', 'failed', 'uncertain')),
  dispatch_command_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, schedule_command_id),
  UNIQUE (profile_id, dispatch_command_id),
  FOREIGN KEY (profile_id, account_id)
    REFERENCES google_accounts(profile_id, account_id)
    ON DELETE CASCADE,
  FOREIGN KEY (profile_id, schedule_command_id)
    REFERENCES mail_commands(profile_id, command_id)
    ON DELETE CASCADE
);

CREATE INDEX scheduled_sends_due
  ON scheduled_sends (state, due_at, profile_id, account_id);

CREATE INDEX scheduled_sends_thread_reply
  ON scheduled_sends (profile_id, account_id, thread_id, state, created_at);
