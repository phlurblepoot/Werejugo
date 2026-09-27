-- Phase 2.5: the people Immich recognised in each family's photos, and which
-- Werejugo person each one is. Photos with a mapped face are tagged with
-- ordinary media-person links whose role is 'face'.
CREATE TABLE immich_people (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  immich_person_id  UUID NOT NULL,
  name              TEXT NOT NULL DEFAULT '',
  birth_date        DATE,
  hidden_in_immich  BOOLEAN NOT NULL DEFAULT false,
  photo_count       INTEGER,
  person_id         UUID REFERENCES people(id) ON DELETE SET NULL,
  ignored           BOOLEAN NOT NULL DEFAULT false,
  immich_updated_at TIMESTAMPTZ,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_at     TIMESTAMPTZ,
  UNIQUE (family_id, immich_person_id)
);
CREATE INDEX immich_people_person ON immich_people (person_id);
