ALTER TABLE google_accounts ADD COLUMN email_address TEXT;
ALTER TABLE google_accounts ADD COLUMN display_name TEXT;
ALTER TABLE google_accounts ADD COLUMN accent TEXT;
ALTER TABLE google_accounts ADD COLUMN backfill_page_token TEXT;
ALTER TABLE google_accounts ADD COLUMN last_sync_requested_at TEXT;

CREATE TABLE google_credentials (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,
  access_token_ciphertext TEXT,
  access_token_expires_at TEXT,
  granted_scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id),
  FOREIGN KEY (profile_id, account_id)
    REFERENCES google_accounts(profile_id, account_id)
    ON DELETE CASCADE
);

CREATE TABLE google_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  code_verifier_ciphertext TEXT NOT NULL,
  return_to TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX google_oauth_states_expiry
  ON google_oauth_states (expires_at);

CREATE TABLE mail_threads (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  history_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL,
  participants_json TEXT NOT NULL CHECK (json_valid(participants_json)),
  received_at TEXT NOT NULL,
  unread INTEGER NOT NULL CHECK (unread IN (0, 1)),
  starred INTEGER NOT NULL CHECK (starred IN (0, 1)),
  important INTEGER NOT NULL CHECK (important IN (0, 1)),
  in_inbox INTEGER NOT NULL CHECK (in_inbox IN (0, 1)),
  needs_response INTEGER NOT NULL CHECK (needs_response IN (0, 1)),
  waiting_on_others INTEGER NOT NULL CHECK (waiting_on_others IN (0, 1)),
  label_ids_json TEXT NOT NULL CHECK (json_valid(label_ids_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id, thread_id),
  FOREIGN KEY (profile_id, account_id)
    REFERENCES google_accounts(profile_id, account_id)
    ON DELETE CASCADE
);

CREATE INDEX mail_threads_inbox_time
  ON mail_threads (profile_id, in_inbox, received_at DESC);
CREATE INDEX mail_threads_account_time
  ON mail_threads (profile_id, account_id, received_at DESC);

CREATE TABLE mail_messages (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  internet_message_id TEXT,
  sender_json TEXT NOT NULL CHECK (json_valid(sender_json)),
  recipients_json TEXT NOT NULL CHECK (json_valid(recipients_json)),
  sent_at TEXT NOT NULL,
  body_text_ciphertext TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id, message_id),
  FOREIGN KEY (profile_id, account_id, thread_id)
    REFERENCES mail_threads(profile_id, account_id, thread_id)
    ON DELETE CASCADE
);

CREATE INDEX mail_messages_thread_order
  ON mail_messages (profile_id, account_id, thread_id, ordinal);

CREATE TABLE tap_reminders (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  due_at TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('if_no_reply', 'regardless')),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'due', 'cancelled', 'satisfied')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, reminder_id),
  FOREIGN KEY (profile_id, account_id)
    REFERENCES google_accounts(profile_id, account_id)
    ON DELETE CASCADE
);

CREATE INDEX tap_reminders_due
  ON tap_reminders (state, due_at, profile_id);
CREATE UNIQUE INDEX tap_reminders_one_active_thread
  ON tap_reminders (profile_id, account_id, thread_id)
  WHERE state IN ('pending', 'due');
