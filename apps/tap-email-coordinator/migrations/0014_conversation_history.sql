ALTER TABLE mail_messages ADD COLUMN body_state TEXT NOT NULL DEFAULT 'ready'
  CHECK (body_state IN ('metadata', 'ready'));

-- Earlier parsers silently retained only the newest 20 messages. Re-read each
-- existing conversation on its next detail request before claiming completeness.
UPDATE mail_threads SET content_state = 'metadata';
