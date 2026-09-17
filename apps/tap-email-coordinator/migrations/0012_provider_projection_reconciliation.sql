ALTER TABLE google_accounts ADD COLUMN sync_generation TEXT;
ALTER TABLE google_accounts ADD COLUMN sync_generation_started_at TEXT;
ALTER TABLE google_accounts ADD COLUMN last_full_sync_completed_at TEXT;

ALTER TABLE mail_threads ADD COLUMN seen_sync_generation TEXT;
ALTER TABLE mail_threads ADD COLUMN content_state TEXT NOT NULL DEFAULT 'full'
  CHECK (content_state IN ('metadata', 'full'));

CREATE INDEX mail_threads_sync_generation
  ON mail_threads (profile_id, account_id, seen_sync_generation, updated_at);

UPDATE google_accounts
   SET unresolved_failures = (
         SELECT COUNT(*) FROM provider_events
          WHERE provider_events.profile_id = google_accounts.profile_id
            AND provider_events.account_id = google_accounts.account_id
            AND provider_events.state IN ('retryable', 'dead_letter')
            AND (
              google_accounts.last_full_sync_completed_at IS NULL OR
              provider_events.updated_at > google_accounts.last_full_sync_completed_at
            )
       ),
       coverage_state = CASE
         WHEN connection_state != 'active' THEN 'blocked'
         WHEN backfill_page_token IS NOT NULL THEN 'backfilling'
         WHEN EXISTS (
           SELECT 1 FROM provider_events
            WHERE provider_events.profile_id = google_accounts.profile_id
              AND provider_events.account_id = google_accounts.account_id
              AND provider_events.state IN ('retryable', 'dead_letter')
              AND (
                google_accounts.last_full_sync_completed_at IS NULL OR
                provider_events.updated_at > google_accounts.last_full_sync_completed_at
              )
         ) THEN 'stale'
         ELSE coverage_state
       END;
