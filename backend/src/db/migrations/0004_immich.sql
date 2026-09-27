-- Phase 2.1: the connection to the owner's Immich server.

-- At most one row: where Immich is and the admin key Werejugo uses (sealed with ENCRYPTION_KEY).
CREATE TABLE immich_server (
  id               BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  url              TEXT NOT NULL,
  admin_key_sealed TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  -- the last health check: {ok, version, supported, error, at}
  last_check       JSONB
);

-- Each family's Immich account. 'created' = Werejugo made it; 'linked' = an
-- account that already existed. Werejugo never deletes the Immich account.
CREATE TABLE family_immich (
  family_id       UUID PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL CHECK (mode IN ('created', 'linked')),
  immich_email    TEXT NOT NULL,
  immich_user_id  UUID UNIQUE,
  api_key_id      UUID,
  api_key_sealed  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at      TIMESTAMPTZ,
  last_error      TEXT
);
