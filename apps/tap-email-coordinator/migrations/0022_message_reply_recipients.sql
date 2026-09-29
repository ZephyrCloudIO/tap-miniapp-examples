ALTER TABLE mail_messages ADD COLUMN cc_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(cc_json));
ALTER TABLE mail_messages ADD COLUMN reply_to_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(reply_to_json));

-- Earlier parsers discarded Cc and Reply-To. Recover the original headers from
-- Gmail on the next conversation read, including conversations already cached.
UPDATE mail_threads SET content_state = 'metadata';
