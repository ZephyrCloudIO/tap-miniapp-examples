CREATE UNIQUE INDEX mail_messages_thread_identity
  ON mail_messages (profile_id, account_id, thread_id, message_id);

CREATE TABLE mail_attachments (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  disposition TEXT NOT NULL CHECK (disposition IN ('attachment', 'inline')),
  content_id TEXT,
  gmail_part_path TEXT NOT NULL,
  gmail_attachment_id_ciphertext TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id, message_id, resource_id),
  UNIQUE (profile_id, account_id, message_id, gmail_part_path),
  FOREIGN KEY (profile_id, account_id, thread_id, message_id)
    REFERENCES mail_messages(profile_id, account_id, thread_id, message_id)
    ON DELETE CASCADE
);

CREATE INDEX mail_attachments_thread_message
  ON mail_attachments (profile_id, account_id, thread_id, message_id);
