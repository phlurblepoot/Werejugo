-- Phase 2.6: each trip is also an album in the Immich account of each family
-- on it, holding that family's photos of the trip. lib/immich/albums.ts keeps
-- the two the same, merging both sides' changes against synced_assets (the
-- album's contents at the last pass).
CREATE TABLE trip_albums (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id          UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- NULL once the trip is deleted: the album is then deleted in Immich, and this row.
  trip_id            UUID REFERENCES trips(id) ON DELETE SET NULL,
  immich_album_id    UUID,
  name               TEXT NOT NULL DEFAULT '',
  synced_assets      UUID[] NOT NULL DEFAULT '{}',
  immich_updated_at  TIMESTAMPTZ,
  immich_asset_count INTEGER,
  -- Something changed in Werejugo since the last pass.
  dirty              BOOLEAN NOT NULL DEFAULT true,
  synced_at          TIMESTAMPTZ,
  last_error         TEXT,
  UNIQUE (family_id, trip_id)
);
CREATE INDEX trip_albums_trip ON trip_albums (trip_id);

-- When a photo's trip last changed in Werejugo: a photo changed on both sides
-- between two passes follows Werejugo.
ALTER TABLE media ADD COLUMN trip_changed_at TIMESTAMPTZ;

CREATE FUNCTION media_trip_changed() RETURNS trigger AS $$
BEGIN
  NEW.trip_changed_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER media_trip_changed BEFORE UPDATE OF trip_id ON media
  FOR EACH ROW WHEN (OLD.trip_id IS DISTINCT FROM NEW.trip_id) EXECUTE FUNCTION media_trip_changed();
CREATE TRIGGER media_trip_set BEFORE INSERT ON media
  FOR EACH ROW WHEN (NEW.trip_id IS NOT NULL) EXECUTE FUNCTION media_trip_changed();

-- A photo put in, moved between or taken out of trips: its family's albums for
-- the old and new trip need a pass.
CREATE FUNCTION trip_albums_media_touched() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.trip_id IS NOT NULL AND OLD.trip_id IS DISTINCT FROM NEW.trip_id THEN
    UPDATE trip_albums SET dirty = true WHERE family_id = OLD.family_id AND trip_id = OLD.trip_id;
  END IF;
  IF NEW.trip_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.trip_id IS DISTINCT FROM NEW.trip_id) THEN
    INSERT INTO trip_albums (family_id, trip_id) VALUES (NEW.family_id, NEW.trip_id)
    ON CONFLICT (family_id, trip_id) DO UPDATE SET dirty = true;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER media_trip_albums AFTER INSERT OR UPDATE OF trip_id ON media
  FOR EACH ROW EXECUTE FUNCTION trip_albums_media_touched();

-- A renamed trip: its albums follow.
CREATE FUNCTION trip_albums_trip_renamed() RETURNS trigger AS $$
BEGIN
  UPDATE trip_albums SET dirty = true WHERE trip_id = NEW.id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trips_album_name AFTER UPDATE OF name ON trips
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION trip_albums_trip_renamed();
