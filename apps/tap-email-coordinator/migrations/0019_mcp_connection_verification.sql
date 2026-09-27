-- Connection setup is not verified until this exact credential completes a read.
ALTER TABLE email_mcp_credentials ADD COLUMN last_verified_at TEXT;
ALTER TABLE email_mcp_credentials ADD COLUMN last_verified_operation TEXT;
