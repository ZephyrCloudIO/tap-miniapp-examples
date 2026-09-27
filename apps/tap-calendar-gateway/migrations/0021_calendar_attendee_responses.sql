-- Old cached projections omitted attendee responses and viewer identity.
-- Versioning forces a complete snapshot after upgrade, even if an older Worker
-- performs an incremental sync between applying this migration and deployment.
ALTER TABLE calendar_sync_state
ADD COLUMN projection_version INTEGER NOT NULL DEFAULT 0;
