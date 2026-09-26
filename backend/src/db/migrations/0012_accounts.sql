-- Phase 1.3: accounts, server admin, one-time invites, password resets, audit log.

ALTER TABLE users
  ADD COLUMN is_admin      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN disabled_at   TIMESTAMPTZ,
  ADD COLUMN last_login_at TIMESTAMPTZ;

ALTER TABLE families
  ADD COLUMN disabled_at TIMESTAMPTZ;

-- The static invite code is replaced by one-time invites (kept until the
-- Phase 1.4 migration squash, no longer required for new families).
ALTER TABLE families ALTER COLUMN invite_code DROP NOT NULL;

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

-- Existing installs: the owner of the oldest family becomes the server admin
-- (the "server owner" of Phase 1.1).
UPDATE users SET is_admin = true
WHERE id = (
  SELECT u.id FROM users u JOIN families f ON f.id = u.family_id
  WHERE u.role = 'owner'
  ORDER BY f.created_at ASC, u.created_at ASC
  LIMIT 1
);
