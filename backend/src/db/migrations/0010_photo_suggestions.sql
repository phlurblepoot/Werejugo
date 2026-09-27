-- Phase 2.7: suggestions from photos.

-- Where a photo was taken, in words: Immich's own reverse geocoding (GeoNames),
-- kept by the sync. Photos synced before this get them at the next full sync.
ALTER TABLE media ADD COLUMN city TEXT, ADD COLUMN state TEXT, ADD COLUMN country TEXT;

-- "My photos in no trip", which most suggestions start from.
CREATE INDEX media_untripped ON media (family_id, taken_at) WHERE trip_id IS NULL AND hidden_at IS NULL;

-- Suggestions a family said no to (lib/suggest.ts keys). A photo suggestion
-- comes back only for photos added after dismissed_at; the others stay away.
CREATE TABLE suggestion_dismissals (
  family_id    UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, key)
);
