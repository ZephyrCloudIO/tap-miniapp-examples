-- Track the source revision of cached content so concurrent metadata writes
-- cannot erase a same-revision body hydrated by another reader.
ALTER TABLE mail_messages ADD COLUMN body_revision TEXT;
UPDATE mail_messages SET body_revision = (SELECT history_id FROM mail_threads t
  WHERE t.profile_id = mail_messages.profile_id AND t.account_id = mail_messages.account_id AND t.thread_id = mail_messages.thread_id);

CREATE TABLE mail_body_backfills (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  lease_expires_at TEXT,
  retry_after TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id),
  FOREIGN KEY (profile_id, account_id) REFERENCES google_accounts(profile_id, account_id) ON DELETE CASCADE
);
CREATE TABLE mail_body_failures (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  error_code TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id, message_id),
  FOREIGN KEY (profile_id, account_id, message_id) REFERENCES mail_messages(profile_id, account_id, message_id) ON DELETE CASCADE
);
CREATE INDEX mail_messages_body_backfill ON mail_messages(profile_id, account_id, body_state, thread_id);
