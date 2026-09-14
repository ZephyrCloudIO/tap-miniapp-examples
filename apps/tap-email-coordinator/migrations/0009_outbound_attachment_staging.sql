CREATE TABLE outbound_attachment_stages (
  profile_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  draft_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  sha256_base64url TEXT NOT NULL,
  chunk_size INTEGER NOT NULL CHECK (chunk_size > 0 AND chunk_size <= 262144),
  expected_chunks INTEGER NOT NULL CHECK (expected_chunks > 0 AND expected_chunks <= 256),
  received_chunks INTEGER NOT NULL DEFAULT 0 CHECK (received_chunks >= 0),
  received_bytes INTEGER NOT NULL DEFAULT 0 CHECK (received_bytes >= 0),
  state TEXT NOT NULL DEFAULT 'staging'
    CHECK (state IN ('staging', 'ready', 'consumed', 'revoked')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, stage_id),
  UNIQUE (profile_id, account_id, idempotency_key),
  FOREIGN KEY (profile_id, account_id)
    REFERENCES google_accounts(profile_id, account_id)
    ON DELETE CASCADE
);

CREATE INDEX outbound_attachment_stages_draft
  ON outbound_attachment_stages
  (profile_id, account_id, draft_key, state, expires_at);

CREATE INDEX outbound_attachment_stages_expiry
  ON outbound_attachment_stages (state, expires_at);

CREATE TABLE outbound_attachment_chunks (
  profile_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0 AND chunk_index < 256),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 262144),
  sha256_base64url TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, stage_id, chunk_index),
  UNIQUE (object_key),
  FOREIGN KEY (profile_id, stage_id)
    REFERENCES outbound_attachment_stages(profile_id, stage_id)
    ON DELETE CASCADE
);
