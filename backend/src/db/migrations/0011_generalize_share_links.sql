-- Generalize share links from map sets to trips/albums. Maps are no longer
-- shareable; there are no real shares to preserve, so clear and retarget.
DELETE FROM share_links;
ALTER TABLE share_links DROP COLUMN map_set_id;
ALTER TABLE share_links ADD COLUMN target_type TEXT NOT NULL;
ALTER TABLE share_links ADD COLUMN target_id   UUID NOT NULL;
ALTER TABLE share_links ADD CONSTRAINT share_target_type_chk CHECK (target_type IN ('trip','album'));
CREATE INDEX idx_share_target ON share_links(target_type, target_id);
