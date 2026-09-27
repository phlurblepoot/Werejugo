-- Werejugo schema baseline (Phase 1.4, 2026-09-26).
--
-- Replaces migrations 0001_init … 0012_accounts. A database created by those
-- older migrations is not upgraded in place: the migration runner refuses to
-- start on it and explains how to reset (see README → "Resetting the database").
--
-- Tenancy: every family-owned table has family_id. Child tables without it
-- (visit_waypoints, comments, packing_items, map_set_visits) are scoped
-- through their parent, in backend/src/lib/access.ts.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Families and accounts
-- ---------------------------------------------------------------------------

-- A household. Its members share everything except what is private per person.
CREATE TABLE families (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- free-form per-family settings (pin appearance defaults, etc.)
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  disabled_at TIMESTAMPTZ
);

-- One login. Belongs to exactly one family.
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  color         TEXT NOT NULL DEFAULT '#2563eb',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- server admin: sees and manages every family (separate from the family role)
  is_admin      BOOLEAN NOT NULL DEFAULT false,
  -- bumped to revoke every token (password change, sign out everywhere, disable)
  token_version INTEGER NOT NULL DEFAULT 0,
  disabled_at   TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ
);
CREATE INDEX idx_users_family ON users(family_id);

-- One-time invite links. Only a SHA-256 of the token is stored.
CREATE TABLE invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('family', 'member')),
  token_hash  TEXT NOT NULL UNIQUE,
  family_id   UUID REFERENCES families(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  note        TEXT NOT NULL DEFAULT '',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  used_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at  TIMESTAMPTZ,
  -- a member invite names its family; a family invite creates one
  CHECK ((kind = 'member') = (family_id IS NOT NULL))
);
CREATE INDEX idx_invites_family ON invites(family_id) WHERE family_id IS NOT NULL;

-- One-time password reset links, made by an admin or the user's family owner.
CREATE TABLE password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);

-- Who did what. Admin access to other families is always recorded here.
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name    TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL,
  family_id     UUID REFERENCES families(id) ON DELETE SET NULL,
  target        TEXT NOT NULL DEFAULT '',
  details       JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_at ON audit_log(at DESC);

-- ---------------------------------------------------------------------------
-- Map styling
-- ---------------------------------------------------------------------------

-- A named collection of pins. (Dropped in Phase 1.6 for the single map.)
CREATE TABLE map_sets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  -- 'vector' uses the configured online vector style; 'custom' renders a user image overlay.
  base_kind       TEXT NOT NULL DEFAULT 'vector' CHECK (base_kind IN ('vector', 'custom')),
  style_url       TEXT,
  overlay_url     TEXT,
  -- geographic bounds of the custom overlay image: [west, south, east, north]
  overlay_bounds  DOUBLE PRECISION[],
  default_lng     DOUBLE PRECISION NOT NULL DEFAULT 0,
  default_lat     DOUBLE PRECISION NOT NULL DEFAULT 20,
  default_zoom    DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_map_sets_family ON map_sets(family_id);

-- Reusable styling presets. Built-in themes have family_id = NULL.
CREATE TABLE themes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     UUID REFERENCES families(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'place',
  icon          TEXT NOT NULL DEFAULT 'pin',   -- built-in icon name OR an uploaded icon URL
  color         TEXT NOT NULL DEFAULT '#2563eb',
  line_color    TEXT NOT NULL DEFAULT '#2563eb',
  line_width    DOUBLE PRECISION NOT NULL DEFAULT 3,
  is_builtin    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_themes_family ON themes(family_id);

-- Custom pin icons uploaded by a family.
CREATE TABLE icons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_icons_family ON icons(family_id);

-- ---------------------------------------------------------------------------
-- Reference data (seeded at start-up; not backed up)
-- ---------------------------------------------------------------------------

CREATE TABLE airports (
  iata     TEXT,
  icao     TEXT,
  name     TEXT NOT NULL,
  city     TEXT,
  country  TEXT,
  lat      DOUBLE PRECISION NOT NULL,
  lng      DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_airports_iata ON airports(iata);
CREATE INDEX idx_airports_icao ON airports(icao);

CREATE TABLE ports (
  name     TEXT NOT NULL,
  country  TEXT,
  lat      DOUBLE PRECISION NOT NULL,
  lng      DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_ports_name ON ports(lower(name));

-- ---------------------------------------------------------------------------
-- The scrapbook: trips, places, people, photos, documents
-- ---------------------------------------------------------------------------

CREATE TABLE trips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  start_date      DATE,
  end_date        DATE,
  cover_photo_url TEXT,
  color           TEXT NOT NULL DEFAULT '#2563eb',
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'planning', 'booked', 'done')),
  CONSTRAINT trips_dates_chk CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX idx_trips_family ON trips(family_id);

CREATE TABLE people (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL,
  relationship    TEXT NOT NULL DEFAULT '',
  avatar_media_id UUID,            -- FK added after media exists
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_people_family ON people(family_id);

-- A place the family went: a spot, a meal, a flight, a cruise, a drive, a stay.
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
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT visits_dates_chk CHECK (occurred_end IS NULL OR occurred_on IS NULL OR occurred_end >= occurred_on)
);
CREATE INDEX idx_visits_family ON visits(family_id);
CREATE INDEX idx_visits_trip ON visits(trip_id);
CREATE INDEX idx_visits_geom ON visits USING GIST (geom);

-- Ordered stops along a route visit (airports, ports, …).
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
CREATE INDEX idx_media_family_taken ON media(family_id, taken_at);
CREATE INDEX idx_media_geom ON media USING GIST (geom);

ALTER TABLE people ADD CONSTRAINT fk_people_avatar
  FOREIGN KEY (avatar_media_id) REFERENCES media(id) ON DELETE SET NULL;

-- Passports, visas, bookings… A document belongs to at most one person OR trip.
CREATE TABLE documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id          UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  doc_type           TEXT NOT NULL DEFAULT 'other'
                       CHECK (doc_type IN ('passport','visa','booking','insurance','other')),
  rel_path           TEXT,          -- NULL until a scan is attached
  original_name      TEXT NOT NULL DEFAULT '',
  owner_person_id    UUID REFERENCES people(id) ON DELETE SET NULL,
  owner_trip_id      UUID REFERENCES trips(id) ON DELETE SET NULL,
  issued_on          DATE,
  expires_on         DATE,
  reminder_lead_days INTEGER NOT NULL DEFAULT 30,
  notes              TEXT NOT NULL DEFAULT '',
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT documents_one_owner_chk CHECK (owner_person_id IS NULL OR owner_trip_id IS NULL)
);
CREATE INDEX idx_documents_family ON documents(family_id);
CREATE INDEX idx_documents_expires ON documents(expires_on);
CREATE INDEX idx_documents_owner_person ON documents(owner_person_id) WHERE owner_person_id IS NOT NULL;
CREATE INDEX idx_documents_owner_trip ON documents(owner_trip_id) WHERE owner_trip_id IS NOT NULL;

CREATE TABLE comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id    UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_visit ON comments(visit_id);

-- Generic relations between entities ("Grandma was on this trip").
-- Rows pointing at a deleted entity are removed by the triggers below.
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
CREATE INDEX idx_links_from_id ON links(from_id);
CREATE INDEX idx_links_to_id ON links(to_id);

-- Read-only public share links for a trip or a trip's album.
CREATE TABLE share_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT NOT NULL UNIQUE,
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  target_type TEXT NOT NULL CONSTRAINT share_target_type_chk CHECK (target_type IN ('trip','album')),
  target_id   UUID NOT NULL
);
CREATE INDEX idx_share_target ON share_links(target_type, target_id);

-- ---------------------------------------------------------------------------
-- Planning
-- ---------------------------------------------------------------------------

CREATE TABLE blackout_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  color       TEXT NOT NULL DEFAULT '#64748b',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT blackout_dates_chk CHECK (end_date >= start_date)
);
CREATE INDEX idx_blackouts_family ON blackout_periods(family_id);

CREATE TABLE itinerary_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id          UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  trip_id            UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  notes              TEXT NOT NULL DEFAULT '',
  scheduled_on       DATE,                    -- NULL = wishlist
  seq                INTEGER NOT NULL DEFAULT 0,
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  place_label        TEXT NOT NULL DEFAULT '',
  converted_visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_itinerary_trip ON itinerary_items(trip_id);
CREATE INDEX idx_itinerary_family ON itinerary_items(family_id);

-- Packing: templates (no trip) and per-trip lists. Private to a family, even
-- on a shared trip, so "one list per trip" is per family.
CREATE TABLE packing_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID REFERENCES families(id) ON DELETE CASCADE,  -- NULL for built-in templates
  trip_id     UUID REFERENCES trips(id) ON DELETE CASCADE,     -- NULL for templates
  name        TEXT NOT NULL,
  is_builtin  BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_packing_lists_family ON packing_lists(family_id);
CREATE INDEX idx_packing_lists_trip ON packing_lists(trip_id);
CREATE UNIQUE INDEX uq_packing_lists_trip_family ON packing_lists(trip_id, family_id) WHERE trip_id IS NOT NULL;

CREATE TABLE packing_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     UUID NOT NULL REFERENCES packing_lists(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  qty         INTEGER,
  checked     BOOLEAN NOT NULL DEFAULT false,
  seq         INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_packing_items_list ON packing_items(list_id);

-- ---------------------------------------------------------------------------
-- Clean-up when things are deleted (directly, or cascaded from a family delete)
-- ---------------------------------------------------------------------------

-- links.from_id / to_id can point at several tables, so they can't have
-- foreign keys; these triggers do the ON DELETE CASCADE instead.
CREATE FUNCTION delete_links_to_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM links
   WHERE (from_type = TG_ARGV[0] AND from_id = OLD.id)
      OR (to_type = TG_ARGV[0] AND to_id = OLD.id);
  RETURN OLD;
END $$;

CREATE TRIGGER trg_visits_links AFTER DELETE ON visits FOR EACH ROW EXECUTE FUNCTION delete_links_to_row('visit');
CREATE TRIGGER trg_trips_links AFTER DELETE ON trips FOR EACH ROW EXECUTE FUNCTION delete_links_to_row('trip');
CREATE TRIGGER trg_people_links AFTER DELETE ON people FOR EACH ROW EXECUTE FUNCTION delete_links_to_row('person');
CREATE TRIGGER trg_media_links AFTER DELETE ON media FOR EACH ROW EXECUTE FUNCTION delete_links_to_row('media');
CREATE TRIGGER trg_documents_links AFTER DELETE ON documents FOR EACH ROW EXECUTE FUNCTION delete_links_to_row('document');

-- A share link dies with the trip it shares (trip and album shares both target a trip).
CREATE FUNCTION delete_share_links_to_trip() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM share_links WHERE target_id = OLD.id AND target_type IN ('trip', 'album');
  RETURN OLD;
END $$;

CREATE TRIGGER trg_trips_share_links AFTER DELETE ON trips FOR EACH ROW EXECUTE FUNCTION delete_share_links_to_trip();
