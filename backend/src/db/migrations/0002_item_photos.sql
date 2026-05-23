-- Photos attached to an item (the scrapbook angle).
CREATE TABLE item_photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',
  seq         INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_item_photos_item ON item_photos(item_id);
