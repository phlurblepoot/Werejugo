-- Phase 2.2: photos and videos live in each family's Immich account. A media
-- row is now a reference to an Immich asset plus a small metadata cache.

-- Test data only (roadmap §2): local photos aren't migrated. Their links and
-- avatar references go with them (trigger / ON DELETE SET NULL); old files stay
-- under STORAGE_DIR until removed by hand (README).
DELETE FROM media;

ALTER TABLE media
  DROP COLUMN rel_path,
  DROP COLUMN thumb_rel_path,
  ADD COLUMN immich_asset_id   UUID NOT NULL UNIQUE,
  ADD COLUMN mime              TEXT NOT NULL DEFAULT '',
  ADD COLUMN duration_ms       INTEGER,
  ADD COLUMN thumbhash         TEXT,
  ADD COLUMN immich_updated_at TIMESTAMPTZ,
  ADD COLUMN synced_at         TIMESTAMPTZ;

-- Per-family library sync state.
ALTER TABLE family_immich
  ADD COLUMN sync_since        TIMESTAMPTZ,
  ADD COLUMN last_sync_at      TIMESTAMPTZ,
  ADD COLUMN last_full_sync_at TIMESTAMPTZ,
  ADD COLUMN sync_error        TEXT,
  ADD COLUMN asset_count       INTEGER;
