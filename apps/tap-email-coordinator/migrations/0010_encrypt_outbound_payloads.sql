ALTER TABLE mail_commands
  ADD COLUMN payload_ciphertext TEXT;

ALTER TABLE scheduled_sends
  ADD COLUMN draft_payload_ciphertext TEXT;
