CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A household. Members share map sets, items, themes and custom icons.
CREATE TABLE families (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A person within a family. Authenticates individually.
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  color         TEXT NOT NULL DEFAULT '#2563eb',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_family ON users(family_id);

-- A named collection of pins ("Summer Trips", "All Cruises", ...).
CREATE TABLE map_sets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  -- 'vector' uses the configured online vector style; 'custom' renders a user image overlay.
  base_kind       TEXT NOT NULL DEFAULT 'vector' CHECK (base_kind IN ('vector', 'custom')),
  style_url       TEXT,                 -- optional override vector style URL
  overlay_url     TEXT,                 -- custom raster overlay image (for base_kind='custom')
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
  -- which kind of item this theme is meant for (advisory; any theme can be used anywhere)
  kind          TEXT NOT NULL DEFAULT 'place',
  icon          TEXT NOT NULL DEFAULT 'pin',   -- built-in icon name OR an uploaded icon URL
  color         TEXT NOT NULL DEFAULT '#2563eb',
  line_color    TEXT NOT NULL DEFAULT '#2563eb',
  line_width    DOUBLE PRECISION NOT NULL DEFAULT 3,
  is_builtin    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_themes_family ON themes(family_id);

-- Custom icons uploaded by a family.
CREATE TABLE icons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_icons_family ON icons(family_id);

-- A pinned thing on a map set: a place, a meal, a flight, a cruise, a drive...
CREATE TABLE items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_set_id    UUID NOT NULL REFERENCES map_sets(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'place'
                  CHECK (kind IN ('place', 'food', 'flight', 'cruise', 'drive', 'custom')),
  title         TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  theme_id      UUID REFERENCES themes(id) ON DELETE SET NULL,
  -- per-item style overrides (fall back to theme, then defaults)
  color         TEXT,
  icon          TEXT,
  occurred_on   DATE,
  -- primary geometry: Point for places, LineString for routes (flight/cruise/drive)
  geom          geometry(Geometry, 4326),
  properties    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_items_map_set ON items(map_set_id);
CREATE INDEX idx_items_geom ON items USING GIST (geom);

-- Ordered stops along a route item (airports for a flight, ports for a cruise, etc.).
CREATE TABLE item_waypoints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'stop'
                CHECK (kind IN ('origin', 'stop', 'destination', 'port')),
  seq         INTEGER NOT NULL DEFAULT 0,
  geom        geometry(Point, 4326) NOT NULL,
  arrive_at   TIMESTAMPTZ,
  depart_at   TIMESTAMPTZ,
  properties  JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_waypoints_item ON item_waypoints(item_id);

-- Reference dataset: airports (seeded from bundled data / OurAirports).
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

-- Reference dataset: notable cruise / sea ports.
CREATE TABLE ports (
  name     TEXT NOT NULL,
  country  TEXT,
  lat      DOUBLE PRECISION NOT NULL,
  lng      DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_ports_name ON ports(lower(name));
