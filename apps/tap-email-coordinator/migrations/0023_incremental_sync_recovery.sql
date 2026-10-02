-- Keep terminal failure audit records while recording proven history recovery.
ALTER TABLE provider_events ADD COLUMN recovered_at TEXT;
