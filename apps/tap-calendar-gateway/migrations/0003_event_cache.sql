CREATE TABLE calendar_sync_state (
  workspace_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES provider_calendars(id) ON DELETE CASCADE,
  active_generation TEXT NOT NULL,
  cache_revision INTEGER NOT NULL DEFAULT 0 CHECK (cache_revision >= 0),
  sync_token TEXT,
  cache_time_min TEXT,
  freshness TEXT NOT NULL CHECK (freshness IN ('pending', 'fresh', 'stale', 'error')),
  last_attempt_at TEXT,
  last_success_at TEXT,
  next_sync_at TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  lease_until TEXT,
  current_watch_channel_id TEXT,
  watch_expiration_at TEXT,
  last_notification_at TEXT,
  PRIMARY KEY (workspace_id, connection_id, calendar_id),
  UNIQUE (calendar_id),
  CHECK (length(active_generation) BETWEEN 1 AND 64)
);

CREATE INDEX calendar_sync_state_repair
  ON calendar_sync_state (next_sync_at, last_attempt_at, calendar_id);

CREATE INDEX calendar_sync_state_connection
  ON calendar_sync_state (workspace_id, connection_id, calendar_id);

CREATE TABLE calendar_event_cache (
  workspace_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES provider_calendars(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  sync_generation TEXT NOT NULL,
  event_id TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  tombstoned INTEGER NOT NULL CHECK (tombstoned IN (0, 1)),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  provider_updated_at TEXT,
  cached_at TEXT NOT NULL,
  PRIMARY KEY (
    workspace_id,
    connection_id,
    calendar_id,
    provider_event_id,
    sync_generation
  ),
  CHECK (length(provider_event_id) BETWEEN 1 AND 2048),
  CHECK (length(sync_generation) BETWEEN 1 AND 64)
);

CREATE INDEX calendar_event_cache_range
  ON calendar_event_cache (
    workspace_id,
    calendar_id,
    sync_generation,
    tombstoned,
    start_at,
    end_at
  );

CREATE TABLE calendar_watch_channels (
  channel_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES provider_calendars(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  expiration_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_notification_at TEXT,
  CHECK (length(channel_id) BETWEEN 1 AND 64),
  CHECK (length(token_hash) BETWEEN 1 AND 128),
  CHECK (length(resource_id) BETWEEN 1 AND 2048)
);

CREATE INDEX calendar_watch_channels_calendar
  ON calendar_watch_channels (workspace_id, connection_id, calendar_id, expiration_at);

CREATE INDEX calendar_watch_channels_expiration
  ON calendar_watch_channels (expiration_at);

CREATE TABLE availability_confirmations (
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, idempotency_key),
  CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  CHECK (length(request_hash) BETWEEN 1 AND 128)
);

INSERT OR IGNORE INTO calendar_sync_state (
  workspace_id,
  connection_id,
  calendar_id,
  active_generation,
  cache_revision,
  sync_token,
  cache_time_min,
  freshness,
  last_attempt_at,
  last_success_at,
  next_sync_at,
  error_code,
  error_message,
  consecutive_failures,
  lease_until,
  current_watch_channel_id,
  watch_expiration_at,
  last_notification_at
)
SELECT
  calendar_connections.workspace_id,
  provider_calendars.connection_id,
  provider_calendars.id,
  'initial',
  0,
  NULL,
  NULL,
  'pending',
  NULL,
  NULL,
  calendar_connections.updated_at,
  NULL,
  NULL,
  0,
  NULL,
  NULL,
  NULL,
  NULL
FROM provider_calendars
INNER JOIN calendar_connections
  ON calendar_connections.id = provider_calendars.connection_id
WHERE calendar_connections.provider = 'google'
  AND calendar_connections.mode = 'oauth'
  AND provider_calendars.role <> 'free-busy';
