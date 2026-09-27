-- Retain the delivery identity so replay/reconciliation never restarts a timer.
ALTER TABLE provider_drafts ADD COLUMN sent_message_id TEXT;
ALTER TABLE provider_drafts ADD COLUMN sent_at TEXT;
