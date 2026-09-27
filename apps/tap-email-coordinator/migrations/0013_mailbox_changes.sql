-- A compact, durable change stream: one latest revision per scoped identity.
-- Tombstones deliberately have no foreign key and survive provider/account deletion.
CREATE TABLE mailbox_changes (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  UNIQUE (profile_id, account_id, thread_id)
);
CREATE INDEX mailbox_changes_profile_revision ON mailbox_changes(profile_id, revision);

-- Seed the upgrade baseline, including threads older than the newest page.
INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
SELECT profile_id, account_id, thread_id, 0 FROM mail_threads
ORDER BY received_at DESC, account_id, thread_id;

-- Explicit DELETE/INSERT avoids inheriting an outer UPSERT's conflict policy.
-- AUTOINCREMENT never reuses the removed revision, including after compaction.
CREATE TRIGGER mailbox_changes_mail_threads_insert AFTER INSERT ON mail_threads
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = NEW.profile_id
    AND account_id = NEW.account_id AND thread_id = NEW.thread_id;
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT NEW.profile_id, NEW.account_id, NEW.thread_id, 0;
END;

CREATE TRIGGER mailbox_changes_mail_threads_update AFTER UPDATE ON mail_threads
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = NEW.profile_id
    AND account_id = NEW.account_id AND thread_id = NEW.thread_id;
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT NEW.profile_id, NEW.account_id, NEW.thread_id, 0;
END;

CREATE TRIGGER mailbox_changes_mail_threads_delete AFTER DELETE ON mail_threads
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = OLD.profile_id
    AND account_id = OLD.account_id AND thread_id = OLD.thread_id;
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT OLD.profile_id, OLD.account_id, OLD.thread_id, 1;
END;

CREATE TRIGGER mailbox_changes_mail_messages_insert AFTER INSERT ON mail_messages
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = NEW.profile_id
    AND account_id = NEW.account_id AND thread_id = NEW.thread_id AND EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT NEW.profile_id, NEW.account_id, NEW.thread_id, 0 WHERE EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
END;

CREATE TRIGGER mailbox_changes_mail_messages_update AFTER UPDATE ON mail_messages
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = NEW.profile_id
    AND account_id = NEW.account_id AND thread_id = NEW.thread_id AND EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT NEW.profile_id, NEW.account_id, NEW.thread_id, 0 WHERE EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
END;

CREATE TRIGGER mailbox_changes_mail_messages_delete AFTER DELETE ON mail_messages
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = OLD.profile_id
    AND account_id = OLD.account_id AND thread_id = OLD.thread_id AND EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = OLD.profile_id AND t.account_id = OLD.account_id AND t.thread_id = OLD.thread_id);
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT OLD.profile_id, OLD.account_id, OLD.thread_id, 0 WHERE EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = OLD.profile_id AND t.account_id = OLD.account_id AND t.thread_id = OLD.thread_id);
END;

CREATE TRIGGER mailbox_changes_mail_attachments_insert AFTER INSERT ON mail_attachments
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = NEW.profile_id
    AND account_id = NEW.account_id AND thread_id = NEW.thread_id AND EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT NEW.profile_id, NEW.account_id, NEW.thread_id, 0 WHERE EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
END;

CREATE TRIGGER mailbox_changes_mail_attachments_update AFTER UPDATE ON mail_attachments
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = NEW.profile_id
    AND account_id = NEW.account_id AND thread_id = NEW.thread_id AND EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT NEW.profile_id, NEW.account_id, NEW.thread_id, 0 WHERE EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
END;

CREATE TRIGGER mailbox_changes_mail_attachments_delete AFTER DELETE ON mail_attachments
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = OLD.profile_id
    AND account_id = OLD.account_id AND thread_id = OLD.thread_id AND EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = OLD.profile_id AND t.account_id = OLD.account_id AND t.thread_id = OLD.thread_id);
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT OLD.profile_id, OLD.account_id, OLD.thread_id, 0 WHERE EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = OLD.profile_id AND t.account_id = OLD.account_id AND t.thread_id = OLD.thread_id);
END;

CREATE TRIGGER mailbox_changes_tap_reminders_insert AFTER INSERT ON tap_reminders
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = NEW.profile_id
    AND account_id = NEW.account_id AND thread_id = NEW.thread_id AND EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT NEW.profile_id, NEW.account_id, NEW.thread_id, 0 WHERE EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
END;

CREATE TRIGGER mailbox_changes_tap_reminders_update AFTER UPDATE ON tap_reminders
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = NEW.profile_id
    AND account_id = NEW.account_id AND thread_id = NEW.thread_id AND EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT NEW.profile_id, NEW.account_id, NEW.thread_id, 0 WHERE EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = NEW.profile_id AND t.account_id = NEW.account_id AND t.thread_id = NEW.thread_id);
END;

CREATE TRIGGER mailbox_changes_tap_reminders_delete AFTER DELETE ON tap_reminders
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = OLD.profile_id
    AND account_id = OLD.account_id AND thread_id = OLD.thread_id AND EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = OLD.profile_id AND t.account_id = OLD.account_id AND t.thread_id = OLD.thread_id);
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT OLD.profile_id, OLD.account_id, OLD.thread_id, 0 WHERE EXISTS (SELECT 1 FROM mail_threads t WHERE t.profile_id = OLD.profile_id AND t.account_id = OLD.account_id AND t.thread_id = OLD.thread_id);
END;

CREATE TRIGGER mailbox_changes_google_accounts_insert AFTER INSERT ON google_accounts
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = NEW.profile_id
    AND account_id = NEW.account_id AND thread_id = '';
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT NEW.profile_id, NEW.account_id, '', 0;
END;

CREATE TRIGGER mailbox_changes_google_accounts_update AFTER UPDATE OF connection_state, email_address, display_name, accent, coverage_state, newest_history_id, backfill_complete_through, unresolved_failures, updated_at ON google_accounts
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = NEW.profile_id
    AND account_id = NEW.account_id AND thread_id = '';
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT NEW.profile_id, NEW.account_id, '', 0;
END;

CREATE TRIGGER mailbox_changes_google_accounts_delete AFTER DELETE ON google_accounts
BEGIN
  DELETE FROM mailbox_changes WHERE profile_id = OLD.profile_id
    AND account_id = OLD.account_id AND thread_id = '';
  INSERT INTO mailbox_changes (profile_id, account_id, thread_id, deleted)
  SELECT OLD.profile_id, OLD.account_id, '', 1;
END;
