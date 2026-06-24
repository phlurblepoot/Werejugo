-- Packing: templates (no trip) and per-trip lists, with categorized items.
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
