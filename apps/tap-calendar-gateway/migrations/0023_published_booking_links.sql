-- The share query must return the URL acknowledged by a publication, not infer
-- one from slugs or today's deployment configuration. Legacy pages remain live
-- but are omitted from the picker until their owner republishes them.
ALTER TABLE public_booking_pages ADD COLUMN canonical_url TEXT;
