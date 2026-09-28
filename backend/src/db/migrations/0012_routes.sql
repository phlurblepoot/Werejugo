-- Phase 3.1: map & routes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Answers from outside services (CruiseMapper, Photon, road routing,
-- AeroDataBox), kept so each question is asked once. It refills itself, so
-- backups leave it out.
CREATE TABLE lookup_cache (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX lookup_cache_expires ON lookup_cache (expires_at);

-- Which version of each bundled reference file is loaded: seeding skips
-- files that haven't changed.
CREATE TABLE reference_data (
  name      TEXT PRIMARY KEY,
  hash      TEXT NOT NULL,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The world's ports (see scripts/build-reference-data.ts), plus ports learned
-- from CruiseMapper sailings (source 'cruisemapper'), which seeding keeps.
-- `search` is the name and aliases without accents or case.
ALTER TABLE ports
  ADD COLUMN locode  TEXT,
  ADD COLUMN source  TEXT NOT NULL DEFAULT 'curated',
  ADD COLUMN aliases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN search  TEXT NOT NULL DEFAULT '';
UPDATE ports SET search = lower(name);
CREATE INDEX ports_search_trgm ON ports USING gin (search gin_trgm_ops);
CREATE UNIQUE INDEX ports_learned ON ports (lower(name), coalesce(country, '')) WHERE source = 'cruisemapper';

-- Every airport with an IATA code (OurAirports); `type` is large, medium,
-- small or seaplane.
ALTER TABLE airports
  ADD COLUMN type   TEXT,
  ADD COLUMN search TEXT NOT NULL DEFAULT '';
UPDATE airports SET search = lower(name || ' ' || coalesce(city, ''));
CREATE INDEX airports_search_trgm ON airports USING gin (search gin_trgm_ops);

-- A create sent twice (a retry after a lost answer) returns the first visit.
ALTER TABLE visits ADD COLUMN client_key UUID;
CREATE UNIQUE INDEX visits_client_key ON visits (family_id, client_key) WHERE client_key IS NOT NULL;
