ALTER TABLE provider_booking_commits ADD COLUMN hold_expires_at TEXT;
ALTER TABLE provider_booking_commits ADD COLUMN hold_expired_at TEXT;

CREATE INDEX provider_booking_holds_expiring
  ON provider_booking_commits (
    booking_kind,
    state,
    resolution_status,
    hold_expired_at,
    hold_expires_at
  );
