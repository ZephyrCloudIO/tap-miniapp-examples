CREATE TABLE mail_profile_users (
  profile_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  authority TEXT NOT NULL CHECK (authority = 'session-and-directory')
);

CREATE TABLE mail_command_attributions (
  profile_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  accepted_command_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  referral_id TEXT,
  referral_url TEXT,
  PRIMARY KEY (profile_id, command_id),
  FOREIGN KEY (profile_id, command_id)
    REFERENCES mail_commands(profile_id, command_id) ON DELETE CASCADE
);
