-- Phase 1 foundation: shared-core rebuild. Greenfield — drop old item tables.
DROP TABLE IF EXISTS item_comments CASCADE;
DROP TABLE IF EXISTS item_photos CASCADE;
DROP TABLE IF EXISTS item_waypoints CASCADE;
DROP TABLE IF EXISTS items CASCADE;

-- Trips become family-scoped only (no longer owned by a map set).
ALTER TABLE trips DROP COLUMN IF EXISTS map_set_id;

CREATE TABLE people (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  relationship  TEXT NOT NULL DEFAULT '',
  avatar_media_id UUID,            -- FK added after media exists
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_people_family ON people(family_id);

CREATE TABLE visits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  trip_id      UUID REFERENCES trips(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'place'
                 CHECK (kind IN ('place','food','flight','cruise','drive','stay','custom')),
  title        TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  theme_id     UUID REFERENCES themes(id) ON DELETE SET NULL,
  color        TEXT,
  icon         TEXT,
  occurred_on  DATE,
  occurred_end DATE,
  geom         geometry(Geometry, 4326),
  properties   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_visits_family ON visits(family_id);
CREATE INDEX idx_visits_trip ON visits(trip_id);
CREATE INDEX idx_visits_geom ON visits USING GIST (geom);

CREATE TABLE visit_waypoints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id    UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'stop'
                CHECK (kind IN ('origin','stop','destination','port')),
  seq         INTEGER NOT NULL DEFAULT 0,
  geom        geometry(Point, 4326) NOT NULL,
  arrive_at   TIMESTAMPTZ,
  depart_at   TIMESTAMPTZ,
  properties  JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_visit_waypoints_visit ON visit_waypoints(visit_id);

CREATE TABLE map_set_visits (
  map_set_id  UUID NOT NULL REFERENCES map_sets(id) ON DELETE CASCADE,
  visit_id    UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (map_set_id, visit_id)
);
CREATE INDEX idx_map_set_visits_visit ON map_set_visits(visit_id);

CREATE TABLE media (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video','audio')),
  trip_id        UUID REFERENCES trips(id) ON DELETE SET NULL,
  rel_path       TEXT NOT NULL,
  thumb_rel_path TEXT,
  original_name  TEXT NOT NULL DEFAULT '',
  caption        TEXT NOT NULL DEFAULT '',
  taken_at       TIMESTAMPTZ,
  geom           geometry(Point, 4326),
  width          INTEGER,
  height         INTEGER,
  bytes          BIGINT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_family ON media(family_id);
CREATE INDEX idx_media_trip ON media(trip_id);

ALTER TABLE people ADD CONSTRAINT fk_people_avatar
  FOREIGN KEY (avatar_media_id) REFERENCES media(id) ON DELETE SET NULL;

CREATE TABLE documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  doc_type         TEXT NOT NULL DEFAULT 'other'
                     CHECK (doc_type IN ('passport','visa','booking','insurance','other')),
  rel_path         TEXT NOT NULL,
  original_name    TEXT NOT NULL DEFAULT '',
  owner_person_id  UUID REFERENCES people(id) ON DELETE SET NULL,
  owner_trip_id    UUID REFERENCES trips(id) ON DELETE SET NULL,
  issued_on        DATE,
  expires_on       DATE,
  reminder_lead_days INTEGER NOT NULL DEFAULT 30,
  notes            TEXT NOT NULL DEFAULT '',
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_family ON documents(family_id);
CREATE INDEX idx_documents_expires ON documents(expires_on);

CREATE TABLE comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id    UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_visit ON comments(visit_id);

CREATE TABLE links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  from_type   TEXT NOT NULL,
  from_id     UUID NOT NULL,
  to_type     TEXT NOT NULL,
  to_id       UUID NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, from_type, from_id, to_type, to_id, role)
);
CREATE INDEX idx_links_from ON links(family_id, from_type, from_id);
CREATE INDEX idx_links_to ON links(family_id, to_type, to_id);
