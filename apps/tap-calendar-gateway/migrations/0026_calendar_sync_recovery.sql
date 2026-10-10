-- Foreground event reads stamp the owner's connections (at most every 10 minutes) so
-- cron cache repair can serve recently active owners first.
ALTER TABLE calendar_connections ADD COLUMN last_read_at TEXT;

-- Calendar lists are rediscovered daily and after access failures; this throttles both
-- per connection.
ALTER TABLE calendar_connections ADD COLUMN discovery_attempted_at TEXT;
