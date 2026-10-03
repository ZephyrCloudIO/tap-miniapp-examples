-- Legacy rows remain unknown until their next provider metadata sync.
-- A conversation-level UNREAD label cannot identify its first unread message.
ALTER TABLE mail_messages ADD COLUMN unread INTEGER
  CHECK (unread IS NULL OR unread IN (0, 1));

CREATE INDEX mail_messages_unread_order
  ON mail_messages (profile_id, account_id, thread_id, ordinal)
  WHERE unread = 1;
