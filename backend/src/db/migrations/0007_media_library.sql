-- Phase 2.4: the library. Werejugo's own "hidden" flag (the photo stays in
-- Immich), and an index for the timeline: newest first, visible photos only.
ALTER TABLE media ADD COLUMN hidden_at TIMESTAMPTZ;

CREATE INDEX media_timeline ON media (family_id, (COALESCE(taken_at, created_at)) DESC, id DESC)
  WHERE hidden_at IS NULL;
