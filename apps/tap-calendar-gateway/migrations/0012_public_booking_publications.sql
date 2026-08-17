-- Server-owned public booking publication registry.
--
-- Organizer state remains in the TAP miniapp. Publishing writes a bounded,
-- validated snapshot here. Anonymous guests resolve only the public projection;
-- provider destinations, conflict calendars, and owner identity never leave the
-- Worker.

CREATE TABLE public_booking_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  source_profile_id TEXT NOT NULL,
  current_slug TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'individual'
    CHECK (owner_type = 'individual'),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'unpublished')),
  publication_generation INTEGER NOT NULL DEFAULT 0
    CHECK (publication_generation >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (workspace_id, principal_id, source_profile_id),
  CHECK (length(id) BETWEEN 8 AND 255),
  CHECK (length(source_profile_id) BETWEEN 1 AND 255),
  CHECK (length(current_slug) BETWEEN 2 AND 64),
  CHECK (length(display_name) BETWEEN 1 AND 160)
);

-- A slug stays reserved to its original profile even after rename/unpublish.
-- This prevents an old, shared booking URL from being taken over by somebody
-- else. One reservation is active for routing; retired rows remain ownership
-- fences and can support future redirects.
CREATE TABLE public_booking_profile_slugs (
  slug TEXT PRIMARY KEY COLLATE NOCASE,
  profile_id TEXT NOT NULL REFERENCES public_booking_profiles(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  retired_at TEXT,
  CHECK (length(slug) BETWEEN 2 AND 64)
);

CREATE UNIQUE INDEX public_booking_profile_active_slug
  ON public_booking_profile_slugs (profile_id)
  WHERE active = 1;

CREATE INDEX public_booking_profiles_owner
  ON public_booking_profiles (workspace_id, principal_id, updated_at DESC, id);

-- A fixed slot ledger enforces the per-owner profile quota under concurrent
-- creation. Competing requests may contend for the same next slot, but one
-- clean retry selects the next free slot; the database can never exceed 20.
CREATE TABLE public_booking_owner_profile_slots (
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 20),
  profile_id TEXT NOT NULL UNIQUE
    REFERENCES public_booking_profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, principal_id, slot)
);

-- Every successful whole-profile mutation claims exactly one generation. The
-- primary key turns concurrent requests based on the same generation into a
-- database constraint failure, rolling the entire D1 batch back atomically.
-- Rows are intentionally retained so a stale writer cannot reuse an old
-- generation after later publishes.
CREATE TABLE public_booking_profile_generations (
  profile_id TEXT NOT NULL REFERENCES public_booking_profiles(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation > 0),
  action TEXT NOT NULL CHECK (action IN ('publish', 'unpublish')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, generation)
);

CREATE TABLE public_booking_pages (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES public_booking_profiles(id) ON DELETE CASCADE,
  source_event_type_id TEXT NOT NULL,
  current_slug TEXT NOT NULL COLLATE NOCASE,
  current_revision_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'paused', 'unpublished')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (profile_id, source_event_type_id),
  CHECK (length(id) BETWEEN 8 AND 255),
  CHECK (length(source_event_type_id) BETWEEN 1 AND 255),
  CHECK (length(current_slug) BETWEEN 2 AND 64)
);

CREATE TABLE public_booking_page_slugs (
  profile_id TEXT NOT NULL REFERENCES public_booking_profiles(id) ON DELETE CASCADE,
  slug TEXT NOT NULL COLLATE NOCASE,
  page_id TEXT NOT NULL REFERENCES public_booking_pages(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  retired_at TEXT,
  PRIMARY KEY (profile_id, slug),
  CHECK (length(slug) BETWEEN 2 AND 64)
);

CREATE UNIQUE INDEX public_booking_page_active_slug
  ON public_booking_page_slugs (page_id)
  WHERE active = 1;

CREATE INDEX public_booking_pages_profile_status
  ON public_booking_pages (profile_id, status, updated_at DESC, id);

-- Revisions are immutable. public_snapshot_json contains only guest-safe copy;
-- private_snapshot_json owns provider routing and availability policy.
CREATE TABLE public_booking_page_revisions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES public_booking_pages(id) ON DELETE CASCADE,
  snapshot_hash TEXT NOT NULL,
  public_snapshot_json TEXT NOT NULL CHECK (json_valid(public_snapshot_json)),
  private_snapshot_json TEXT NOT NULL CHECK (json_valid(private_snapshot_json)),
  created_at TEXT NOT NULL,
  UNIQUE (page_id, snapshot_hash),
  CHECK (length(id) BETWEEN 8 AND 255),
  CHECK (length(snapshot_hash) BETWEEN 16 AND 128),
  CHECK (length(public_snapshot_json) BETWEEN 2 AND 32768),
  CHECK (length(private_snapshot_json) BETWEEN 2 AND 131072)
);

CREATE INDEX public_booking_page_revisions_page
  ON public_booking_page_revisions (page_id, created_at DESC, id);

-- SQLite cannot add this circular FK while creating public_booking_pages, so
-- routing code validates the referenced revision belongs to the same page.

CREATE TABLE public_booking_publication_audit (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES public_booking_profiles(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES public_booking_pages(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('publish', 'pause', 'unpublish', 'rename')),
  revision_id TEXT,
  created_at TEXT NOT NULL,
  CHECK (length(id) BETWEEN 8 AND 255)
);

CREATE INDEX public_booking_publication_audit_owner
  ON public_booking_publication_audit (
    workspace_id,
    principal_id,
    created_at DESC,
    id
  );
