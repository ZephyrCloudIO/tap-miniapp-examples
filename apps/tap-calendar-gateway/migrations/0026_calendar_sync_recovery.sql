-- Foreground event reads stamp the owner's connections (at most every 10 minutes) so
-- cron cache repair can serve recently active owners first.
ALTER TABLE calendar_connections ADD COLUMN last_read_at TEXT;

-- Calendar lists are rediscovered daily and after access failures; this throttles both
-- per connection.
ALTER TABLE calendar_connections ADD COLUMN discovery_attempted_at TEXT;

-- Full cache rebuilds run on the rebuild queue. This marks a calendar whose rebuild is
-- queued so reads and cron do not enqueue it again; a rebuild or recorded failure clears it.
ALTER TABLE calendar_sync_state ADD COLUMN rebuild_queued_at TEXT;
