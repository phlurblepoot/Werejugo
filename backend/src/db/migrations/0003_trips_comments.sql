-- Trips group related items (the flights, hotels, meals and drives of one vacation).
CREATE TABLE trips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  map_set_id      UUID NOT NULL REFERENCES map_sets(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  start_date      DATE,
  end_date        DATE,
  cover_photo_url TEXT,
  color           TEXT NOT NULL DEFAULT '#2563eb',
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trips_map_set ON trips(map_set_id);
CREATE INDEX idx_trips_family ON trips(family_id);

ALTER TABLE items ADD COLUMN trip_id UUID REFERENCES trips(id) ON DELETE SET NULL;
CREATE INDEX idx_items_trip ON items(trip_id);

-- Family members can comment on items.
CREATE TABLE item_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_item_comments_item ON item_comments(item_id);
