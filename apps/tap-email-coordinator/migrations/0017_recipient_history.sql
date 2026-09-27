-- A small address index independent of which threads are currently loaded.
-- Account removal cascades; ordinary thread retention does not erase history.
CREATE TABLE mail_recipient_history (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  address TEXT NOT NULL,
  display_name TEXT NOT NULL,
  last_sent_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id, address),
  FOREIGN KEY (profile_id, account_id)
    REFERENCES google_accounts(profile_id, account_id) ON DELETE CASCADE
);

CREATE INDEX mail_recipient_history_recent
  ON mail_recipient_history (profile_id, last_sent_at DESC);

-- Existing accounts need one complete pass to recover older messages and
-- Cc/Bcc recipients absent from their cached reader projection. New accounts
-- already get a complete initial mailbox sync.
ALTER TABLE google_accounts ADD COLUMN recipient_history_backfill_pending INTEGER NOT NULL DEFAULT 0;
UPDATE google_accounts SET recipient_history_backfill_pending = 1
 WHERE connection_state != 'revoked';

-- Older snapshots retained To but not Cc/Bcc or per-message SENT labels.
-- Recover known sent To addresses now; subsequent sync indexes all three
-- headers from messages explicitly marked SENT, including send-as aliases.
INSERT INTO mail_recipient_history
  (profile_id, account_id, address, display_name, last_sent_at)
SELECT m.profile_id, m.account_id,
       lower(trim(json_extract(recipient.value, '$.address'))),
       coalesce(json_extract(recipient.value, '$.name'), ''),
       max(m.sent_at)
  FROM mail_messages m
  JOIN google_accounts a
    ON a.profile_id = m.profile_id AND a.account_id = m.account_id
  JOIN mail_threads t
    ON t.profile_id = m.profile_id AND t.account_id = m.account_id
   AND t.thread_id = m.thread_id
  JOIN json_each(m.recipients_json) recipient
 WHERE lower(json_extract(m.sender_json, '$.address')) = lower(a.email_address)
   AND EXISTS (SELECT 1 FROM json_each(t.label_ids_json) WHERE value = 'SENT')
   AND NOT EXISTS (SELECT 1 FROM json_each(t.label_ids_json) WHERE value = 'DRAFT')
   AND json_extract(recipient.value, '$.address') LIKE '%@%'
 GROUP BY m.profile_id, m.account_id, lower(trim(json_extract(recipient.value, '$.address')));
