CREATE TABLE mail_draft_leases (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  draft_key TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, account_id, draft_key),
  FOREIGN KEY (profile_id, account_id)
    REFERENCES google_accounts(profile_id, account_id)
    ON DELETE CASCADE
);

CREATE INDEX mail_draft_leases_expiry
  ON mail_draft_leases (lease_expires_at, profile_id, account_id);
