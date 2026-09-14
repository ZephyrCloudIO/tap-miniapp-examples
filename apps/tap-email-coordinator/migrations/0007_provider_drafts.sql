CREATE TABLE provider_drafts (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  draft_key TEXT NOT NULL,
  provider_draft_id TEXT,
  thread_id TEXT,
  latest_revision INTEGER NOT NULL CHECK (latest_revision > 0),
  state TEXT NOT NULL CHECK (state IN ('active', 'sent', 'discarded')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id, draft_key),
  UNIQUE (profile_id, account_id, provider_draft_id),
  FOREIGN KEY (profile_id, account_id)
    REFERENCES google_accounts(profile_id, account_id)
    ON DELETE CASCADE
);

CREATE INDEX provider_drafts_state
  ON provider_drafts (profile_id, account_id, state, updated_at);
