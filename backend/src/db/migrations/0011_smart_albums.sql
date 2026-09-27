-- Phase 2.8: smart albums, saved filters (and smart-search text) evaluated
-- when opened, so they fill themselves as photos arrive; shareable by link.
CREATE TABLE smart_albums (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  -- The library's filters (person, trip, visit, from, to, kind, noTrip) and q, the search text.
  filters    JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX smart_albums_family ON smart_albums (family_id);

ALTER TABLE share_links DROP CONSTRAINT share_target_type_chk;
ALTER TABLE share_links ADD CONSTRAINT share_target_type_chk CHECK (target_type IN ('trip', 'album', 'smart_album'));

-- A share link dies with the smart album it shares.
CREATE FUNCTION delete_share_links_to_smart_album() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM share_links WHERE target_id = OLD.id AND target_type = 'smart_album';
  RETURN OLD;
END $$;
CREATE TRIGGER trg_smart_albums_share_links AFTER DELETE ON smart_albums FOR EACH ROW EXECUTE FUNCTION delete_share_links_to_smart_album();
