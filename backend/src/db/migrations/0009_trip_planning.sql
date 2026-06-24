-- Trip planning: status lifecycle, blackout periods, and itinerary items.
ALTER TABLE trips ADD COLUMN status TEXT NOT NULL DEFAULT 'idea'
  CHECK (status IN ('idea', 'planning', 'booked', 'done'));

CREATE TABLE blackout_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  color       TEXT NOT NULL DEFAULT '#64748b',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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
