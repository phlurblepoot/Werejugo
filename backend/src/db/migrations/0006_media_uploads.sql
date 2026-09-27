-- Phase 2.3: uploads in chunks. One row per file on its way to Immich; the
-- bytes wait in UPLOADS_DIR/incoming/<id>.part until Immich has them.
CREATE TABLE media_uploads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  filename         TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  mime             TEXT NOT NULL DEFAULT '',
  size             BIGINT NOT NULL CHECK (size > 0),
  file_modified_at TIMESTAMPTZ,
  caption          TEXT NOT NULL DEFAULT '',
  link_to          TEXT,
  link_role        TEXT NOT NULL DEFAULT '',
  received         BIGINT NOT NULL DEFAULT 0 CHECK (received >= 0 AND received <= size),
  state            TEXT NOT NULL DEFAULT 'receiving' CHECK (state IN ('receiving', 'processing', 'done', 'failed')),
  media_id         UUID REFERENCES media(id) ON DELETE SET NULL,
  duplicate        BOOLEAN NOT NULL DEFAULT false,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX media_uploads_owner ON media_uploads (family_id, user_id, state);
