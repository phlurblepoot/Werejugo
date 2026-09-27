-- Phase 1.5: trips shared between families, cross-family people, activity.

-- Guest families on a trip. The host is trips.family_id and is not listed here.
CREATE TABLE trip_members (
  trip_id    UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  family_id  UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('coowner', 'contributor')),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, family_id)
);
CREATE INDEX idx_trip_members_family ON trip_members(family_id);

-- One-time links inviting another family onto a trip. Only a hash is stored.
CREATE TABLE trip_invites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('coowner', 'contributor')),
  token_hash     TEXT NOT NULL UNIQUE,
  note           TEXT NOT NULL DEFAULT '',
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,
  used_by_family UUID REFERENCES families(id) ON DELETE SET NULL,
  revoked_at     TIMESTAMPTZ
);
CREATE INDEX idx_trip_invites_trip ON trip_invites(trip_id);

-- "Our Grandma is your Grandma": the same person in two families.
CREATE TABLE person_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_a         UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,  -- the proposing family's person
  person_b         UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,  -- the other family's person
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  requested_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at     TIMESTAMPTZ,
  CHECK (person_a <> person_b)
);
CREATE UNIQUE INDEX uq_person_links_pair ON person_links (LEAST(person_a, person_b), GREATEST(person_a, person_b));
CREATE INDEX idx_person_links_b ON person_links(person_b);

-- What happened on a trip, and who did it (feed; later push notifications).
CREATE TABLE activity (
  id          BIGSERIAL PRIMARY KEY,
  trip_id     UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  family_id   UUID REFERENCES families(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id   UUID,
  summary     TEXT NOT NULL DEFAULT '',
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_trip ON activity(trip_id, at DESC);

-- Attribution: who added an itinerary item (places, photos and comments already record it).
ALTER TABLE itinerary_items ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;
