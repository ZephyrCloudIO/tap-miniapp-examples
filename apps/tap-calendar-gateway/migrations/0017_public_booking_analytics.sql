-- One anonymous, in-memory visit ID per page load. No guest details or IPs.
CREATE TABLE public_booking_funnel_visits (
  page_id TEXT NOT NULL REFERENCES public_booking_pages(id) ON DELETE CASCADE,
  visit_id TEXT NOT NULL CHECK (length(visit_id) = 36),
  slot_viewed INTEGER NOT NULL DEFAULT 0 CHECK (slot_viewed IN (0, 1)),
  started INTEGER NOT NULL DEFAULT 0 CHECK (started IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (page_id, visit_id)
);

CREATE INDEX public_booking_attempts_revision_state
  ON public_booking_attempts (revision_id, workspace_id, principal_id, state);
