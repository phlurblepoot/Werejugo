# Phase 1A — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Werejugo backend around the shared-core architecture — `people`, `visits`, `media`, `documents`, and a universal `links` table — with a browsable file-storage tree, and refactor the Map's existing routes onto it, so the frontend shell (Plan 1B) and all later modules build on a clean, API-testable base.

**Architecture:** Greenfield schema rebuild (no real data to preserve): drop the old `items`/`item_photos`/`item_waypoints`/`item_comments` tables and replace them with the shared core. A `links` service connects any two core entities (allow-listed pairs). Private files (photos, documents) live in a human-browsable `storage/` tree (`trips/<slug>/photos/`, `loose/<year>/`, `people/<slug>/`) with readable names; the DB stores only the relative path. A photo belongs to at most one trip via `media.trip_id` (inherited when linked to a visit in a trip); changing that moves the file (the "reconciler"). Private files are served through signed URLs so `<img>` tags work without auth headers but guessable paths alone don't grant access. Public assets (icons, map overlays) keep the existing random-name `/uploads` static mount.

**Tech Stack:** Fastify 5 (ESM, `.js` import suffixes), PostgreSQL/PostGIS via `pg`, `zod` validation, `@fastify/jwt`, `sharp` thumbnails, `exifr`. Tests: **Vitest** (added in Task 1) against a dedicated Postgres test database.

**Scope note:** This plan is **Plan 1A** of Phase 1. It delivers a working, API-testable backend. **Plan 1B** (frontend shell + shared components + Map UI refactor) follows and consumes these APIs. The `people` and `documents` tables are created here (so links and storage work), but their dedicated CRUD route surfaces ship with their module phases (People = Phase 2, Documents = Phase 4). Media and visits are fully wired here because the Map depends on them.

---

## Conventions (apply to every task)

- **Run commands from `backend/`** unless stated otherwise.
- **ESM imports use `.js` suffixes** even for `.ts` files (e.g. `import { query } from "../db/pool.js"`), matching the existing codebase.
- **Routes** follow the existing shape: `export async function xRoutes(app: FastifyInstance)`, `app.addHook("preHandler", requireAuth)`, `zod` `safeParse` → 400 on failure, `req.user.familyId` / `req.user.id` for scoping, snake_case rows → camelCase DTOs, 404 on cross-family access.
- **DB access** via `query`, `tx`, `withClient` from `src/db/pool.js`.
- **Commit** after each task with the message shown in its final step.

---

## File Structure

**New files:**
- `backend/vitest.config.ts` — Vitest config (test DB env, globalSetup).
- `backend/src/test/globalSetup.ts` — create/migrate the test database once per run.
- `backend/src/test/helpers.ts` — `buildTestApp()`, `resetDb()`, auth-token helper.
- `backend/src/db/migrations/0007_foundation.sql` — the schema rebuild.
- `backend/src/lib/storage.ts` — path/slug/filename helpers, media file save+thumb, move/delete, reconciler.
- `backend/src/lib/filesign.ts` — signed file-URL generation/verification.
- `backend/src/lib/links.ts` — link allow-list + create/list/delete service (incl. trip inheritance).
- `backend/src/lib/refs.ts` — entity-reference parsing/validation (`"visit:<uuid>"`).
- `backend/src/routes/links.ts` — `/api/links` endpoints.
- `backend/src/routes/files.ts` — signed private-file serving (`/api/files/*`).
- `backend/src/routes/visits.ts` — visits CRUD + waypoints + comments (replaces `items.ts`).
- `backend/src/routes/media.ts` — media upload/list/patch/delete + set-trip.

**Modified files:**
- `backend/package.json` — add Vitest + `test` script.
- `backend/src/config.ts` — add `storageDir`.
- `backend/src/index.ts` — extract `buildApp()`; register new routes; drop `itemRoutes`.
- `backend/src/db/seed.ts` — add fake-data seeding in the new shape.
- `backend/src/routes/mapsets.ts` — add map↔visit membership endpoints.
- `backend/src/routes/trips.ts` — family-scoped (no `map_set_id`).
- `backend/src/routes/stats.ts`, `export.ts`, `import.ts`, `share.ts` — port `items`→`visits`, `item_photos`→`media`.

**Deleted files:**
- `backend/src/routes/items.ts` — replaced by `visits.ts` + `media.ts`.

---

## Task 1: Test harness (Vitest + test database)

**Files:**
- Modify: `backend/package.json`
- Create: `backend/vitest.config.ts`, `backend/src/test/globalSetup.ts`, `backend/src/test/helpers.ts`
- Modify: `backend/src/index.ts` (extract `buildApp`)

- [ ] **Step 1: Add Vitest and a test script**

Run:
```bash
cd backend && npm install -D vitest@^2.1.0
```
Then edit `backend/package.json` `scripts` to add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Extract `buildApp()` from `index.ts` so tests can mount the app**

Replace the body of `backend/src/index.ts` with a factory + a runner. **Preserve the current route set exactly** (including `itemRoutes`) — later tasks add/swap registrations as they create each new route module, so the app compiles after every task:

```ts
import { mkdir } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { mapSetRoutes } from "./routes/mapsets.js";
import { itemRoutes } from "./routes/items.js";
import { themeRoutes } from "./routes/themes.js";
import { uploadRoutes } from "./routes/uploads.js";
import { lookupRoutes } from "./routes/lookup.js";
import { tripRoutes } from "./routes/trips.js";
import { statsRoutes } from "./routes/stats.js";
import { exifRoutes } from "./routes/exif.js";
import { importRoutes } from "./routes/import.js";
import { exportRoutes } from "./routes/export.js";
import { shareRoutes } from "./routes/share.js";
import { settingsRoutes } from "./routes/settings.js";

export async function buildApp(): Promise<FastifyInstance> {
  await mkdir(config.uploadsDir, { recursive: true });

  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  await app.register(cors, {
    origin: config.corsOrigin.length ? config.corsOrigin : true,
    credentials: true,
  });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: config.jwtExpiresIn } });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(fastifyStatic, { root: config.uploadsDir, prefix: "/uploads/" });

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(mapSetRoutes);
  await app.register(itemRoutes);
  await app.register(themeRoutes);
  await app.register(uploadRoutes);
  await app.register(lookupRoutes);
  await app.register(tripRoutes);
  await app.register(statsRoutes);
  await app.register(exifRoutes);
  await app.register(importRoutes);
  await app.register(exportRoutes);
  await app.register(shareRoutes);
  await app.register(settingsRoutes);

  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ host: "0.0.0.0", port: config.port });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

> **Route registration is incremental.** Each later task that creates a route module also adds its `import` + `await app.register(...)` line here: Task 9 → `fileRoutes`, Task 11 → `linkRoutes`, Task 12 → `mediaRoutes`, Task 13 → `visitRoutes` (and removes `itemRoutes`). This keeps the backend compiling and each task's tests runnable. Task 14 does a final check that all are present.

- [ ] **Step 3: Write the Vitest config**

Create `backend/vitest.config.ts`. Note: `test.env` only reaches the forked test workers, but `globalSetup` runs in vitest's **main process** and imports `db/pool.ts` (which reads `DATABASE_URL` at import time). So we also set the vars on `process.env` at config-load time:
```ts
import { defineConfig } from "vitest/config";

// Set the test env on process.env at config-load time so that BOTH the
// globalSetup (main process, imports db/pool.ts) and the forked test workers
// see them. `test.env` alone only reaches workers.
const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "postgres://werejugo:change-me-in-production@localhost:5432/werejugo_test",
  JWT_SECRET: "test-secret",
  STORAGE_DIR: "/tmp/werejugo-test-storage",
  UPLOADS_DIR: "/tmp/werejugo-test-uploads",
};
for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;

export default defineConfig({
  test: {
    globalSetup: ["./src/test/globalSetup.ts"],
    env: TEST_ENV,
    fileParallelism: false,
    pool: "forks",
  },
});
```

- [ ] **Step 4: Write the global setup (create + migrate the test DB)**

Create `backend/src/test/globalSetup.ts`:
```ts
import pg from "pg";

// Ensure the test database exists, then run migrations against it.
export async function setup(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  // Import after env is set so pool.ts picks up the test DATABASE_URL.
  const { migrate } = await import("../db/migrate.js");
  const { pool } = await import("../db/pool.js");
  await migrate();
  await pool.end();
}
```

- [ ] **Step 5: Write the test helpers**

Create `backend/src/test/helpers.ts`:
```ts
import { mkdir, rm } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { pool, query } from "../db/pool.js";
import { buildApp } from "../index.js";

export interface TestCtx {
  app: FastifyInstance;
  token: string;
  familyId: string;
  userId: string;
}

const APP_TABLES = [
  "links", "comments", "visit_waypoints", "map_set_visits",
  "media", "documents", "visits", "trips", "people",
  "icons", "themes", "map_sets", "share_links", "users", "families",
];

/** Truncate all app tables (keeps reference data: airports/ports) and wipe the
 *  storage tree so file paths are reproducible across runs. */
export async function resetDb(): Promise<void> {
  await query(`TRUNCATE ${APP_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await rm(config.storageDir, { recursive: true, force: true });
  await mkdir(config.storageDir, { recursive: true });
}

/** Build the app, reset the DB, and create one family + owner user with a signed token. */
export async function buildTestApp(): Promise<TestCtx> {
  const app = await buildApp();
  await resetDb();
  const fam = await query<{ id: string }>(
    "INSERT INTO families (name, invite_code) VALUES ('Test Family', 'invite-123') RETURNING id",
  );
  const familyId = fam.rows[0].id;
  const user = await query<{ id: string }>(
    `INSERT INTO users (family_id, email, display_name, password_hash, role)
     VALUES ($1, 'owner@test.dev', 'Owner', 'x', 'owner') RETURNING id`,
    [familyId],
  );
  const userId = user.rows[0].id;
  const token = app.jwt.sign({ id: userId, familyId, role: "owner" });
  return { app, token, familyId, userId };
}

export async function closeTestApp(ctx: TestCtx): Promise<void> {
  await ctx.app.close();
  await pool.end();
}
```

- [ ] **Step 6: Smoke test the harness**

Create `backend/src/test/harness.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "./helpers.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

test("health endpoint responds", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});
```

> This test requires the new schema (Task 2) for `resetDb()` to succeed. Run it after Task 2. For now, verify the files typecheck-compile in isolation.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/vitest.config.ts backend/src/test backend/src/index.ts
git commit -m "test: add vitest harness with test-db helpers; extract buildApp()"
```

---

## Task 2: Schema rebuild migration

**Files:**
- Create: `backend/src/db/migrations/0007_foundation.sql`

- [ ] **Step 1: Write the migration**

Create `backend/src/db/migrations/0007_foundation.sql` (the migrate runner wraps each file in a transaction, so no explicit `BEGIN`/`COMMIT`):
```sql
-- Phase 1 foundation: shared-core rebuild. Greenfield — drop old item tables.
DROP TABLE IF EXISTS item_comments CASCADE;
DROP TABLE IF EXISTS item_photos CASCADE;
DROP TABLE IF EXISTS item_waypoints CASCADE;
DROP TABLE IF EXISTS items CASCADE;

-- Trips become family-scoped only (no longer owned by a map set).
ALTER TABLE trips DROP COLUMN IF EXISTS map_set_id;

CREATE TABLE people (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  relationship  TEXT NOT NULL DEFAULT '',
  avatar_media_id UUID,            -- FK added after media exists
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_people_family ON people(family_id);

CREATE TABLE visits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  trip_id      UUID REFERENCES trips(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'place'
                 CHECK (kind IN ('place','food','flight','cruise','drive','stay','custom')),
  title        TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  theme_id     UUID REFERENCES themes(id) ON DELETE SET NULL,
  color        TEXT,
  icon         TEXT,
  occurred_on  DATE,
  occurred_end DATE,
  geom         geometry(Geometry, 4326),
  properties   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_visits_family ON visits(family_id);
CREATE INDEX idx_visits_trip ON visits(trip_id);
CREATE INDEX idx_visits_geom ON visits USING GIST (geom);

CREATE TABLE visit_waypoints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id    UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'stop'
                CHECK (kind IN ('origin','stop','destination','port')),
  seq         INTEGER NOT NULL DEFAULT 0,
  geom        geometry(Point, 4326) NOT NULL,
  arrive_at   TIMESTAMPTZ,
  depart_at   TIMESTAMPTZ,
  properties  JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_visit_waypoints_visit ON visit_waypoints(visit_id);

CREATE TABLE map_set_visits (
  map_set_id  UUID NOT NULL REFERENCES map_sets(id) ON DELETE CASCADE,
  visit_id    UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (map_set_id, visit_id)
);
CREATE INDEX idx_map_set_visits_visit ON map_set_visits(visit_id);

CREATE TABLE media (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video','audio')),
  trip_id        UUID REFERENCES trips(id) ON DELETE SET NULL,
  rel_path       TEXT NOT NULL,
  thumb_rel_path TEXT,
  original_name  TEXT NOT NULL DEFAULT '',
  caption        TEXT NOT NULL DEFAULT '',
  taken_at       TIMESTAMPTZ,
  geom           geometry(Point, 4326),
  width          INTEGER,
  height         INTEGER,
  bytes          BIGINT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_family ON media(family_id);
CREATE INDEX idx_media_trip ON media(trip_id);

ALTER TABLE people ADD CONSTRAINT fk_people_avatar
  FOREIGN KEY (avatar_media_id) REFERENCES media(id) ON DELETE SET NULL;

CREATE TABLE documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  doc_type         TEXT NOT NULL DEFAULT 'other'
                     CHECK (doc_type IN ('passport','visa','booking','insurance','other')),
  rel_path         TEXT NOT NULL,
  original_name    TEXT NOT NULL DEFAULT '',
  owner_person_id  UUID REFERENCES people(id) ON DELETE SET NULL,
  owner_trip_id    UUID REFERENCES trips(id) ON DELETE SET NULL,
  issued_on        DATE,
  expires_on       DATE,
  reminder_lead_days INTEGER NOT NULL DEFAULT 30,
  notes            TEXT NOT NULL DEFAULT '',
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_family ON documents(family_id);
CREATE INDEX idx_documents_expires ON documents(expires_on);

CREATE TABLE comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id    UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_visit ON comments(visit_id);

CREATE TABLE links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  from_type   TEXT NOT NULL,
  from_id     UUID NOT NULL,
  to_type     TEXT NOT NULL,
  to_id       UUID NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, from_type, from_id, to_type, to_id, role)
);
CREATE INDEX idx_links_from ON links(family_id, from_type, from_id);
CREATE INDEX idx_links_to ON links(family_id, to_type, to_id);
```

- [ ] **Step 2: Apply it to a clean dev database and verify**

Run (a clean reset is fine — greenfield):
```bash
cd backend && npm run migrate
```
Expected: `[migrate] applying 0007_foundation.sql` then `[migrate] up to date`. If the dev DB still has fake rows in `items`, the `DROP ... CASCADE` handles them.

- [ ] **Step 3: Run the harness smoke test (now that the schema exists)**

Run:
```bash
cd backend && npm test -- src/test/harness.test.ts
```
Expected: PASS (1 test). This confirms `resetDb()`'s `TRUNCATE` list matches the real tables.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/0007_foundation.sql
git commit -m "feat(db): foundation schema — people, visits, media, documents, links"
```

---

## Task 3: Entity-reference helper

**Files:**
- Create: `backend/src/lib/refs.ts`
- Test: `backend/src/lib/refs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/refs.test.ts`:
```ts
import { expect, test } from "vitest";
import { parseRef, CORE_TYPES } from "./refs.js";

test("parses a valid ref", () => {
  expect(parseRef("visit:11111111-1111-1111-1111-111111111111")).toEqual({
    type: "visit",
    id: "11111111-1111-1111-1111-111111111111",
  });
});

test("rejects unknown type", () => {
  expect(parseRef("dragon:11111111-1111-1111-1111-111111111111")).toBeNull();
});

test("rejects malformed id", () => {
  expect(parseRef("visit:not-a-uuid")).toBeNull();
});

test("exposes the core type list", () => {
  expect(CORE_TYPES).toContain("media");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npm test -- src/lib/refs.test.ts`
Expected: FAIL ("Cannot find module './refs.js'").

- [ ] **Step 3: Implement**

Create `backend/src/lib/refs.ts`:
```ts
export const CORE_TYPES = ["visit", "trip", "person", "media", "document"] as const;
export type CoreType = (typeof CORE_TYPES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EntityRef {
  type: CoreType;
  id: string;
}

/** Parse "type:uuid" into a validated ref, or null if invalid. */
export function parseRef(raw: string): EntityRef | null {
  const idx = raw.indexOf(":");
  if (idx === -1) return null;
  const type = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (!(CORE_TYPES as readonly string[]).includes(type)) return null;
  if (!UUID_RE.test(id)) return null;
  return { type: type as CoreType, id };
}

/** DB table name for a core type. */
export const TABLE_FOR: Record<CoreType, string> = {
  visit: "visits",
  trip: "trips",
  person: "people",
  media: "media",
  document: "documents",
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/lib/refs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/refs.ts backend/src/lib/refs.test.ts
git commit -m "feat: entity-reference parsing helper"
```

---

## Task 4: Config — storage directory

**Files:**
- Modify: `backend/src/config.ts`

- [ ] **Step 1: Add `storageDir`**

In `backend/src/config.ts`, add inside the exported `config` object (after the `uploadsDir` line):
```ts
  storageDir: process.env.STORAGE_DIR ?? "/app/storage",
```

- [ ] **Step 2: Ensure the storage dir is created at boot**

In `backend/src/index.ts` `buildApp()`, add below the existing uploads `mkdir`:
```ts
  await mkdir(config.storageDir, { recursive: true });
```

- [ ] **Step 3: Verify typecheck**

Run: `cd backend && npm run typecheck`
Expected: no new errors from `config.ts`/`index.ts`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/config.ts backend/src/index.ts
git commit -m "feat(config): add STORAGE_DIR for the private file tree"
```

---

## Task 5: Storage path & filename helpers (pure)

**Files:**
- Create: `backend/src/lib/storage.ts`
- Test: `backend/src/lib/storage.test.ts`

These are the pure, deterministic helpers. File I/O (save/move) is added in Task 6.

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/storage.test.ts`:
```ts
import { expect, test } from "vitest";
import { slugify, tripSlug, mediaDirFor, documentDirFor } from "./storage.js";

test("slugify lowercases and kebab-cases", () => {
  expect(slugify("Joe's Pizza & Pasta!")).toBe("joes-pizza-pasta");
});

test("tripSlug prefixes the start year when present", () => {
  expect(tripSlug("Italy Adventure", "2024-06-01")).toBe("2024-italy-adventure");
  expect(tripSlug("Italy Adventure", null)).toBe("italy-adventure");
});

test("mediaDirFor uses the trip folder when a trip is given", () => {
  expect(mediaDirFor({ name: "Italy", startDate: "2024-06-01" }, new Date("2024-06-10"))).toBe(
    "trips/2024-italy/photos",
  );
});

test("mediaDirFor falls back to loose/<year> with no trip", () => {
  expect(mediaDirFor(null, new Date("2023-03-04"))).toBe("loose/2023");
});

test("mediaDirFor uses 'unknown' year when no date", () => {
  expect(mediaDirFor(null, null)).toBe("loose/unknown");
});

test("documentDirFor routes by owner", () => {
  expect(documentDirFor({ tripName: "Italy", tripStart: "2024-06-01" }, null)).toBe(
    "trips/2024-italy/documents",
  );
  expect(documentDirFor(null, { personName: "Dad" })).toBe("people/dad");
  expect(documentDirFor(null, null)).toBe("loose/documents");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/lib/storage.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pure helpers**

Create `backend/src/lib/storage.ts`:
```ts
import { join } from "node:path";
import { config } from "../config.js";

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/['']/g, "")           // drop apostrophes so "Joe's" -> "joes"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "untitled";
}

export function tripSlug(name: string, startDate: string | null): string {
  const base = slugify(name);
  if (!startDate) return base;
  const year = startDate.slice(0, 4);
  return `${year}-${base}`;
}

export interface TripFolderInfo {
  name: string;
  startDate: string | null;
}

/** Relative directory (under storageDir) where a media file belongs. */
export function mediaDirFor(trip: TripFolderInfo | null, takenAt: Date | null): string {
  if (trip) return `trips/${tripSlug(trip.name, trip.startDate)}/photos`;
  const year = takenAt && !isNaN(takenAt.getTime()) ? String(takenAt.getFullYear()) : "unknown";
  return `loose/${year}`;
}

/** Relative directory where a document file belongs. */
export function documentDirFor(
  trip: { tripName: string; tripStart: string | null } | null,
  person: { personName: string } | null,
): string {
  if (trip) return `trips/${tripSlug(trip.tripName, trip.tripStart)}/documents`;
  if (person) return `people/${slugify(person.personName)}`;
  return "loose/documents";
}

/** Absolute path for a relative storage path. */
export function absStoragePath(relPath: string): string {
  return join(config.storageDir, relPath);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/lib/storage.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/storage.ts backend/src/lib/storage.test.ts
git commit -m "feat(storage): pure path/slug helpers for the file tree"
```

---

## Task 6: Storage file I/O — save, unique names, move, delete

**Files:**
- Modify: `backend/src/lib/storage.ts`
- Test: `backend/src/lib/storage.io.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/storage.io.test.ts`:
```ts
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wj-store-"));
  // Point config.storageDir at the temp dir for this test file.
  vi.resetModules();
  process.env.STORAGE_DIR = dir;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("uniqueName avoids collisions within a directory", async () => {
  const { uniqueName } = await import("./storage.js");
  await mkdir(join(dir, "loose/2024"), { recursive: true });
  await writeFile(join(dir, "loose/2024/photo.jpg"), "a");
  expect(await uniqueName("loose/2024", "photo.jpg")).toBe("photo-2.jpg");
  expect(await uniqueName("loose/2024", "fresh.jpg")).toBe("fresh.jpg");
});

test("moveStored relocates a file and returns the new rel path", async () => {
  const { moveStored, absStoragePath } = await import("./storage.js");
  await mkdir(join(dir, "loose/2024"), { recursive: true });
  await writeFile(join(dir, "loose/2024/a.jpg"), "x");
  const newRel = await moveStored("loose/2024/a.jpg", "trips/2024-italy/photos");
  expect(newRel).toBe("trips/2024-italy/photos/a.jpg");
  expect(existsSync(absStoragePath("loose/2024/a.jpg"))).toBe(false);
  expect(await readFile(absStoragePath(newRel), "utf8")).toBe("x");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/lib/storage.io.test.ts`
Expected: FAIL (`uniqueName`/`moveStored` not exported).

- [ ] **Step 3: Implement the I/O helpers**

Append to `backend/src/lib/storage.ts`:
```ts
import { mkdir, rename, unlink, access } from "node:fs/promises";
import { basename, extname } from "node:path";

async function exists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

/** A collision-free filename within relDir, derived from the original name. */
export async function uniqueName(relDir: string, originalName: string): Promise<string> {
  const ext = extname(originalName).toLowerCase();
  const stem = slugify(basename(originalName, ext)) || "file";
  let candidate = `${stem}${ext}`;
  let n = 2;
  while (await exists(absStoragePath(join(relDir, candidate)))) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

/** Move a stored file into relDir (de-duping its name); returns the new rel path. */
export async function moveStored(relPath: string, relDir: string): Promise<string> {
  const name = await uniqueName(relDir, basename(relPath));
  const destRel = join(relDir, name);
  await mkdir(absStoragePath(relDir), { recursive: true });
  await rename(absStoragePath(relPath), absStoragePath(destRel));
  return destRel;
}

/** Best-effort delete of a stored file. */
export async function deleteStored(relPath: string | null): Promise<void> {
  if (!relPath) return;
  try {
    await unlink(absStoragePath(relPath));
  } catch {
    /* already gone */
  }
}

export { exists as storedExists };
```

> Add the new `import` lines at the top of the file with the existing imports (Vitest/tsc will flag duplicate import blocks — consolidate `node:path` imports into one line: `import { basename, extname, join } from "node:path";`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/lib/storage.io.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/storage.ts backend/src/lib/storage.io.test.ts
git commit -m "feat(storage): unique-name, move, and delete file I/O"
```

---

## Task 7: Save uploaded media (stream + thumbnail + EXIF)

**Files:**
- Modify: `backend/src/lib/storage.ts`
- Test: `backend/src/lib/storage.save.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/storage.save.test.ts`:
```ts
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wj-save-"));
  vi.resetModules();
  process.env.STORAGE_DIR = dir;
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("saveMediaUpload stores an image and a thumbnail", async () => {
  const { saveMediaUpload, absStoragePath } = await import("./storage.js");
  const png = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#fff" },
  }).png().toBuffer();

  const result = await saveMediaUpload(
    { filename: "Sunset Photo.png", file: Readable.from(png) },
    "loose/2024",
  );

  expect(result.kind).toBe("image");
  expect(result.relPath).toBe("loose/2024/sunset-photo.png");
  expect(result.thumbRelPath).toBe("loose/2024/sunset-photo.thumb.jpg");
  expect(existsSync(absStoragePath(result.relPath))).toBe(true);
  expect(existsSync(absStoragePath(result.thumbRelPath!))).toBe(true);
});

test("saveMediaUpload rejects unsupported extensions", async () => {
  const { saveMediaUpload } = await import("./storage.js");
  await expect(
    saveMediaUpload({ filename: "x.exe", file: Readable.from(Buffer.from("x")) }, "loose/2024"),
  ).rejects.toThrow("UNSUPPORTED_TYPE");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/lib/storage.save.test.ts`
Expected: FAIL (`saveMediaUpload` not exported).

- [ ] **Step 3: Implement**

Append to `backend/src/lib/storage.ts`:
```ts
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".ogg", ".wav", ".aac"]);

export type MediaKind = "image" | "video" | "audio";

function kindForExt(ext: string): MediaKind {
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "image";
}

export interface SavedMedia {
  relPath: string;
  thumbRelPath: string | null;
  kind: MediaKind;
  width: number | null;
  height: number | null;
}

/** Stream an upload into relDir, generate a thumbnail for raster images. */
export async function saveMediaUpload(
  part: { filename: string; file: NodeJS.ReadableStream },
  relDir: string,
): Promise<SavedMedia> {
  const ext = extname(part.filename).toLowerCase();
  if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext) && !AUDIO_EXT.has(ext)) {
    throw new Error("UNSUPPORTED_TYPE");
  }
  const name = await uniqueName(relDir, part.filename);
  const relPath = join(relDir, name);
  await mkdir(absStoragePath(relDir), { recursive: true });
  await pipeline(part.file, createWriteStream(absStoragePath(relPath)));

  const kind = kindForExt(ext);
  let thumbRelPath: string | null = null;
  let width: number | null = null;
  let height: number | null = null;

  if (kind === "image" && ext !== ".gif") {
    try {
      const meta = await sharp(absStoragePath(relPath)).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      const thumbName = `${basename(name, ext)}.thumb.jpg`;
      const thumbRel = join(relDir, thumbName);
      await sharp(absStoragePath(relPath))
        .rotate()
        .resize(400, 400, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(absStoragePath(thumbRel));
      thumbRelPath = thumbRel;
    } catch {
      thumbRelPath = null;
    }
  }
  return { relPath, thumbRelPath, kind, width, height };
}
```

> Consolidate the `node:path`, `node:fs/promises`, and `sharp` imports with the existing ones at the top of the file (no duplicate import statements).

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/lib/storage.save.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/storage.ts backend/src/lib/storage.save.test.ts
git commit -m "feat(storage): save media uploads with thumbnails"
```

---

## Task 8: Signed file URLs

**Files:**
- Create: `backend/src/lib/filesign.ts`
- Test: `backend/src/lib/filesign.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/filesign.test.ts`:
```ts
import { expect, test, vi } from "vitest";

test("a freshly signed url verifies", async () => {
  vi.resetModules();
  process.env.JWT_SECRET = "test-secret";
  const { signFileUrl, verifyFileToken } = await import("./filesign.js");
  const url = signFileUrl("trips/2024-italy/photos/a.jpg");
  const params = new URL("http://x" + url.slice(url.indexOf("/api/files"))).searchParams;
  expect(
    verifyFileToken("trips/2024-italy/photos/a.jpg", params.get("exp")!, params.get("sig")!),
  ).toBe(true);
});

test("a tampered path fails verification", async () => {
  vi.resetModules();
  process.env.JWT_SECRET = "test-secret";
  const { signFileUrl, verifyFileToken } = await import("./filesign.js");
  const url = signFileUrl("trips/2024-italy/photos/a.jpg");
  const params = new URL("http://x" + url.slice(url.indexOf("/api/files"))).searchParams;
  expect(verifyFileToken("trips/2024-italy/photos/secret.jpg", params.get("exp")!, params.get("sig")!)).toBe(false);
});

test("an expired token fails verification", async () => {
  vi.resetModules();
  process.env.JWT_SECRET = "test-secret";
  const { verifyFileToken, signPath } = await import("./filesign.js");
  const past = String(Date.now() - 1000);
  const sig = signPath("a.jpg", past);
  expect(verifyFileToken("a.jpg", past, sig)).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/lib/filesign.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `backend/src/lib/filesign.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function signPath(relPath: string, exp: string): string {
  return createHmac("sha256", config.jwtSecret).update(`${relPath}:${exp}`).digest("hex");
}

/** Build a signed, time-limited URL the browser can load directly in <img>. */
export function signFileUrl(relPath: string): string {
  const exp = String(Date.now() + TTL_MS);
  const sig = signPath(relPath, exp);
  const encoded = relPath.split("/").map(encodeURIComponent).join("/");
  return `/api/files/${encoded}?exp=${exp}&sig=${sig}`;
}

export function verifyFileToken(relPath: string, exp: string, sig: string): boolean {
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = signPath(relPath, exp);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/lib/filesign.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/filesign.ts backend/src/lib/filesign.test.ts
git commit -m "feat: signed time-limited URLs for private files"
```

---

## Task 9: Private file-serving route

**Files:**
- Create: `backend/src/routes/files.ts`
- Test: `backend/src/routes/files.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/files.test.ts`:
```ts
import { mkdir, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { absStoragePath } from "../lib/storage.js";
import { signFileUrl } from "../lib/filesign.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

test("serves a file with a valid signature", async () => {
  await mkdir(absStoragePath("loose/2024"), { recursive: true });
  await writeFile(absStoragePath("loose/2024/a.txt"), "hello");
  const url = signFileUrl("loose/2024/a.txt");
  const res = await ctx.app.inject({ method: "GET", url });
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe("hello");
});

test("rejects a bad signature", async () => {
  const res = await ctx.app.inject({
    method: "GET",
    url: "/api/files/loose/2024/a.txt?exp=" + (Date.now() + 1000) + "&sig=deadbeef",
  });
  expect(res.statusCode).toBe(403);
});

test("rejects path traversal", async () => {
  const url = signFileUrl("../../etc/passwd");
  const res = await ctx.app.inject({ method: "GET", url });
  // app.inject normalizes `..` out of the path before routing (→ 404), and the
  // handler's own `..` check rejects any that survive (→ 403). Either way the
  // file is never served (and a valid signature is impossible without the secret).
  expect([403, 404]).toContain(res.statusCode);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/files.test.ts`
Expected: FAIL (`fileRoutes` not registered / module missing). *(Ensure Task 14's `index.ts` registers `fileRoutes`, or temporarily register it in `buildApp` now.)*

- [ ] **Step 3: Implement**

Create `backend/src/routes/files.ts`:
```ts
import { createReadStream } from "node:fs";
import { normalize } from "node:path";
import type { FastifyInstance } from "fastify";
import { absStoragePath, storedExists } from "../lib/storage.js";
import { verifyFileToken } from "../lib/filesign.js";

// Private file serving. No requireAuth hook — access is granted by a valid
// signed token in the query string, so <img> tags work without headers.
export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/files/*", async (req, reply) => {
    const relPath = decodeURIComponent((req.params as { "*": string })["*"]);
    const { exp, sig } = req.query as { exp?: string; sig?: string };

    // Reject traversal: the normalized path must stay within storage.
    if (relPath.includes("..") || normalize(relPath).startsWith("..")) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    if (!exp || !sig || !verifyFileToken(relPath, exp, sig)) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    if (!(await storedExists(absStoragePath(relPath)))) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.send(createReadStream(absStoragePath(relPath)));
  });
}
```

- [ ] **Step 4: Register the route in `index.ts`**

In `backend/src/index.ts`, add the import `import { fileRoutes } from "./routes/files.js";` and `await app.register(fileRoutes);` (place it near `mapSetRoutes`).

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/files.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/files.ts backend/src/routes/files.test.ts backend/src/index.ts
git commit -m "feat(files): signed private-file serving route"
```

---

## Task 10: Links service

**Files:**
- Create: `backend/src/lib/links.ts`
- Test: `backend/src/routes/links.test.ts` (integration; service is exercised through routes in Task 11, but unit-test the allow-list here)
- Test: `backend/src/lib/links.test.ts`

- [ ] **Step 1: Write the failing unit test for the allow-list**

Create `backend/src/lib/links.test.ts`:
```ts
import { expect, test } from "vitest";
import { isAllowedPair } from "./links.js";

test("allows visit-media in either order", () => {
  expect(isAllowedPair("visit", "media")).toBe(true);
  expect(isAllowedPair("media", "visit")).toBe(true);
});

test("allows trip-person and person-media", () => {
  expect(isAllowedPair("trip", "person")).toBe(true);
  expect(isAllowedPair("person", "media")).toBe(true);
});

test("disallows media-trip (that is the media.trip_id FK, not a link)", () => {
  expect(isAllowedPair("media", "trip")).toBe(false);
});

test("disallows nonsense pairs", () => {
  expect(isAllowedPair("document", "document")).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/lib/links.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

Create `backend/src/lib/links.ts`:
```ts
import type { PoolClient } from "pg";
import { query, tx } from "../db/pool.js";
import { parseRef, TABLE_FOR, type CoreType, type EntityRef } from "./refs.js";
import { reconcileMediaTrip } from "./reconcile.js";

// Canonical unordered allow-list. media↔trip is intentionally excluded:
// a photo's trip is the media.trip_id FK (Task 12), not a link.
const ALLOWED = new Set(["media|visit", "person|visit", "person|trip", "media|person"]);

function pairKey(a: CoreType, b: CoreType): string {
  return [a, b].sort().join("|");
}

export function isAllowedPair(a: CoreType, b: CoreType): boolean {
  return ALLOWED.has(pairKey(a, b));
}

async function belongsToFamily(familyId: string, ref: EntityRef): Promise<boolean> {
  const { rowCount } = await query(
    `SELECT 1 FROM ${TABLE_FOR[ref.type]} WHERE id = $1 AND family_id = $2`,
    [ref.id, familyId],
  );
  return Boolean(rowCount);
}

export interface LinkDto {
  id: string;
  from: string;
  to: string;
  role: string;
}

export type LinkResult =
  | { ok: true; link: LinkDto }
  | { ok: false; code: number; error: string };

/** Create a link after validating types, family ownership, and trip inheritance. */
export async function createLink(
  familyId: string,
  userId: string,
  fromRaw: string,
  toRaw: string,
  role: string,
): Promise<LinkResult> {
  const from = parseRef(fromRaw);
  const to = parseRef(toRaw);
  if (!from || !to) return { ok: false, code: 400, error: "Invalid entity reference" };
  if (!isAllowedPair(from.type, to.type)) {
    return { ok: false, code: 400, error: "That link type is not allowed" };
  }
  if (!(await belongsToFamily(familyId, from)) || !(await belongsToFamily(familyId, to))) {
    return { ok: false, code: 404, error: "Entity not found" };
  }

  // media↔visit: a photo inherits the visit's trip (move-on-link). Reject conflicts.
  const mediaVisit = pickMediaVisit(from, to);
  if (mediaVisit) {
    const conflict = await applyTripInheritance(familyId, mediaVisit.mediaId, mediaVisit.visitId);
    if (conflict) return { ok: false, code: 409, error: conflict };
  }

  const { rows } = await query<{ id: string }>(
    `INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (family_id, from_type, from_id, to_type, to_id, role) DO UPDATE SET role = EXCLUDED.role
     RETURNING id`,
    [familyId, from.type, from.id, to.type, to.id, role, userId],
  );
  return { ok: true, link: { id: rows[0].id, from: fromRaw, to: toRaw, role } };
}

function pickMediaVisit(a: EntityRef, b: EntityRef): { mediaId: string; visitId: string } | null {
  if (a.type === "media" && b.type === "visit") return { mediaId: a.id, visitId: b.id };
  if (a.type === "visit" && b.type === "media") return { mediaId: b.id, visitId: a.id };
  return null;
}

/** Set media.trip_id from the visit's trip if unset; return an error string on conflict. */
async function applyTripInheritance(
  familyId: string,
  mediaId: string,
  visitId: string,
): Promise<string | null> {
  const v = await query<{ trip_id: string | null }>(
    "SELECT trip_id FROM visits WHERE id = $1 AND family_id = $2",
    [visitId, familyId],
  );
  const visitTrip = v.rows[0]?.trip_id ?? null;
  if (!visitTrip) return null;

  const m = await query<{ trip_id: string | null }>(
    "SELECT trip_id FROM media WHERE id = $1 AND family_id = $2",
    [mediaId, familyId],
  );
  const mediaTrip = m.rows[0]?.trip_id ?? null;
  if (mediaTrip && mediaTrip !== visitTrip) {
    return "This photo already belongs to a different trip";
  }
  if (!mediaTrip) {
    await tx(async (client: PoolClient) => {
      await client.query("UPDATE media SET trip_id = $1 WHERE id = $2", [visitTrip, mediaId]);
      await reconcileMediaTrip(client, mediaId);
    });
  }
  return null;
}

export async function listLinks(familyId: string, entityRaw: string): Promise<LinkDto[] | null> {
  const ref = parseRef(entityRaw);
  if (!ref) return null;
  const { rows } = await query<{ id: string; from_type: string; from_id: string; to_type: string; to_id: string; role: string }>(
    `SELECT id, from_type, from_id, to_type, to_id, role FROM links
     WHERE family_id = $1 AND ((from_type = $2 AND from_id = $3) OR (to_type = $2 AND to_id = $3))
     ORDER BY created_at ASC`,
    [familyId, ref.type, ref.id],
  );
  return rows.map((r) => ({
    id: r.id,
    from: `${r.from_type}:${r.from_id}`,
    to: `${r.to_type}:${r.to_id}`,
    role: r.role,
  }));
}

export async function deleteLink(familyId: string, id: string): Promise<boolean> {
  const res = await query("DELETE FROM links WHERE id = $1 AND family_id = $2", [id, familyId]);
  return Boolean(res.rowCount);
}
```

> `reconcile.ts` (the `reconcileMediaTrip` helper) is created in Task 12. To keep this task compiling, Task 12 must land before running the links integration tests; the unit test in this task does not touch it.

- [ ] **Step 4: Run the allow-list unit test to verify it passes**

Run: `cd backend && npm test -- src/lib/links.test.ts`
Expected: PASS (4 tests). *(If `reconcile.js` import breaks compilation, temporarily stub `backend/src/lib/reconcile.ts` with `export async function reconcileMediaTrip(){}` and flesh it out in Task 12.)*

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/links.ts backend/src/lib/links.test.ts
git commit -m "feat(links): allow-listed link service with trip inheritance"
```

---

## Task 11: Links routes

**Files:**
- Create: `backend/src/routes/links.ts`
- Test: `backend/src/routes/links.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `backend/src/routes/links.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let visitId: string;
let mediaId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  const v = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title) VALUES ($1,'place','Eiffel Tower') RETURNING id",
    [ctx.familyId],
  );
  visitId = v.rows[0].id;
  const m = await query<{ id: string }>(
    "INSERT INTO media (family_id, kind, rel_path) VALUES ($1,'image','loose/2024/a.jpg') RETURNING id",
    [ctx.familyId],
  );
  mediaId = m.rows[0].id;
});
afterAll(async () => { await closeTestApp(ctx); });

const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates and lists a media↔visit link", async () => {
  const create = await ctx.app.inject({
    method: "POST", url: "/api/links", headers: auth(),
    payload: { from: `media:${mediaId}`, to: `visit:${visitId}`, role: "appears_in" },
  });
  expect(create.statusCode).toBe(201);

  const list = await ctx.app.inject({
    method: "GET", url: `/api/links?entity=visit:${visitId}`, headers: auth(),
  });
  expect(list.statusCode).toBe(200);
  expect(list.json()).toHaveLength(1);
});

test("rejects a disallowed pair", async () => {
  const res = await ctx.app.inject({
    method: "POST", url: "/api/links", headers: auth(),
    payload: { from: `media:${mediaId}`, to: `trip:${visitId}` },
  });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/links.test.ts`
Expected: FAIL (route not found / module missing).

- [ ] **Step 3: Implement the routes**

Create `backend/src/routes/links.ts`:
```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { createLink, deleteLink, listLinks } from "../lib/links.js";

const createSchema = z.object({
  from: z.string().min(3),
  to: z.string().min(3),
  role: z.string().max(60).optional(),
});

export async function linkRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/links", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await createLink(
      req.user.familyId, req.user.id, parsed.data.from, parsed.data.to, parsed.data.role ?? "",
    );
    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    return reply.code(201).send(result.link);
  });

  app.get("/api/links", async (req, reply) => {
    const entity = (req.query as { entity?: string }).entity;
    if (!entity) return reply.code(400).send({ error: "entity query param required" });
    const links = await listLinks(req.user.familyId, entity);
    if (links === null) return reply.code(400).send({ error: "Invalid entity reference" });
    return links;
  });

  app.delete("/api/links/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const ok = await deleteLink(req.user.familyId, id);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Register the route in `index.ts`**

Add `import { linkRoutes } from "./routes/links.js";` and `await app.register(linkRoutes);`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/links.test.ts`
Expected: PASS (2 tests). *(Requires Task 12's `reconcile.ts`; land Task 12 first or keep the temporary stub.)*

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/links.ts backend/src/routes/links.test.ts backend/src/index.ts
git commit -m "feat(links): /api/links endpoints"
```

---

## Task 12: Media reconciler + media routes

**Files:**
- Create: `backend/src/lib/reconcile.ts`
- Create: `backend/src/routes/media.ts`
- Test: `backend/src/routes/media.test.ts`

- [ ] **Step 1: Write the reconciler**

Create `backend/src/lib/reconcile.ts`:
```ts
import type { PoolClient } from "pg";
import { mediaDirFor, moveStored } from "./storage.js";

/** Re-home a media file to match its current trip_id. Call inside a transaction. */
export async function reconcileMediaTrip(client: PoolClient, mediaId: string): Promise<void> {
  const { rows } = await client.query<{
    rel_path: string; thumb_rel_path: string | null; taken_at: string | null;
    trip_name: string | null; trip_start: string | null;
  }>(
    `SELECT m.rel_path, m.thumb_rel_path, m.taken_at, t.name AS trip_name, t.start_date AS trip_start
     FROM media m LEFT JOIN trips t ON t.id = m.trip_id
     WHERE m.id = $1`,
    [mediaId],
  );
  const m = rows[0];
  if (!m) return;
  const trip = m.trip_name ? { name: m.trip_name, startDate: m.trip_start } : null;
  const takenAt = m.taken_at ? new Date(m.taken_at) : null;
  const destDir = mediaDirFor(trip, takenAt);

  const currentDir = m.rel_path.slice(0, m.rel_path.lastIndexOf("/"));
  if (currentDir === destDir) return;

  const newRel = await moveStored(m.rel_path, destDir);
  let newThumb: string | null = null;
  if (m.thumb_rel_path) newThumb = await moveStored(m.thumb_rel_path, destDir);
  await client.query("UPDATE media SET rel_path = $1, thumb_rel_path = $2 WHERE id = $3", [
    newRel, newThumb, mediaId,
  ]);
}
```

- [ ] **Step 2: Write the failing media-routes test**

Create `backend/src/routes/media.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import sharp from "sharp";
import FormData from "form-data";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

async function uploadPng(filename = "trip pic.png"): Promise<string> {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#abc" } }).png().toBuffer();
  const form = new FormData();
  form.append("file", png, { filename, contentType: "image/png" });
  const res = await ctx.app.inject({
    method: "POST", url: "/api/media", headers: { ...auth(), ...form.getHeaders() }, payload: form,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

test("uploads media to loose/<year> by default and returns a signed url", async () => {
  const id = await uploadPng();
  const row = await query<{ rel_path: string }>("SELECT rel_path FROM media WHERE id = $1", [id]);
  expect(row.rows[0].rel_path).toMatch(/^loose\/\d{4}\/trip-pic\.png$/);
  const dto = await ctx.app.inject({ method: "GET", url: `/api/media/${id}`, headers: auth() });
  expect(dto.json().url).toContain("/api/files/");
  expect(dto.json().url).toContain("sig=");
});

test("setting a media's trip moves the file into the trip folder", async () => {
  // Distinct filename so it doesn't collide with the previous test's upload.
  const id = await uploadPng("italy pic.png");
  const t = await query<{ id: string }>(
    "INSERT INTO trips (family_id, name, start_date) VALUES ($1,'Italy','2024-06-01') RETURNING id",
    [ctx.familyId],
  );
  const res = await ctx.app.inject({
    method: "PATCH", url: `/api/media/${id}`, headers: auth(), payload: { tripId: t.rows[0].id },
  });
  expect(res.statusCode).toBe(200);
  const row = await query<{ rel_path: string }>("SELECT rel_path FROM media WHERE id = $1", [id]);
  expect(row.rows[0].rel_path).toBe("trips/2024-italy/photos/italy-pic.png");
});
```

> Add the `form-data` dev dependency: `npm install -D form-data@^4.0.0`.

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/media.test.ts`
Expected: FAIL (route missing).

- [ ] **Step 4: Implement the media routes**

Create `backend/src/routes/media.ts`:
```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { mediaDirFor, saveMediaUpload, deleteStored } from "../lib/storage.js";
import { reconcileMediaTrip } from "../lib/reconcile.js";
import { signFileUrl } from "../lib/filesign.js";

interface MediaRow {
  id: string; kind: string; trip_id: string | null;
  rel_path: string; thumb_rel_path: string | null;
  original_name: string; caption: string; taken_at: string | null;
  width: number | null; height: number | null; created_at: string;
}

function toDto(r: MediaRow) {
  return {
    id: r.id, kind: r.kind, tripId: r.trip_id,
    url: signFileUrl(r.rel_path),
    thumbUrl: r.thumb_rel_path ? signFileUrl(r.thumb_rel_path) : null,
    originalName: r.original_name, caption: r.caption,
    takenAt: r.taken_at, width: r.width, height: r.height, createdAt: r.created_at,
  };
}

async function loadMedia(familyId: string, id: string): Promise<MediaRow | null> {
  const { rows } = await query<MediaRow>(
    "SELECT * FROM media WHERE id = $1 AND family_id = $2", [id, familyId],
  );
  return rows[0] ?? null;
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Upload a new media file (multipart: `file`, optional `caption`).
  app.post("/api/media", async (req, reply) => {
    let caption = "";
    let saved: Awaited<ReturnType<typeof saveMediaUpload>> | null = null;
    let originalName = "";
    for await (const part of req.parts()) {
      if (part.type === "file") {
        originalName = part.filename;
        try {
          saved = await saveMediaUpload(part, mediaDirFor(null, new Date()));
        } catch {
          return reply.code(400).send({ error: "Unsupported file type" });
        }
      } else if (part.fieldname === "caption" && typeof part.value === "string") {
        caption = part.value.slice(0, 500);
      }
    }
    if (!saved) return reply.code(400).send({ error: "No file provided" });
    const { rows } = await query<MediaRow>(
      `INSERT INTO media (family_id, kind, rel_path, thumb_rel_path, original_name, caption, width, height, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.familyId, saved.kind, saved.relPath, saved.thumbRelPath, originalName, caption, saved.width, saved.height, req.user.id],
    );
    return reply.code(201).send(toDto(rows[0]));
  });

  app.get("/api/media/:id", async (req, reply) => {
    const row = await loadMedia(req.user.familyId, (req.params as { id: string }).id);
    if (!row) return reply.code(404).send({ error: "Not found" });
    return toDto(row);
  });

  const patchSchema = z.object({
    caption: z.string().max(500).optional(),
    tripId: z.string().uuid().nullable().optional(),
  });

  app.patch("/api/media/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = await loadMedia(req.user.familyId, id);
    if (!row) return reply.code(404).send({ error: "Not found" });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;

    if (b.caption !== undefined) {
      await query("UPDATE media SET caption = $2 WHERE id = $1", [id, b.caption]);
    }
    if (Object.prototype.hasOwnProperty.call(b, "tripId")) {
      // Validate the trip belongs to the family (when non-null).
      if (b.tripId) {
        const t = await query("SELECT 1 FROM trips WHERE id = $1 AND family_id = $2", [b.tripId, req.user.familyId]);
        if (!t.rowCount) return reply.code(404).send({ error: "Trip not found" });
      }
      await tx(async (client) => {
        await client.query("UPDATE media SET trip_id = $1 WHERE id = $2", [b.tripId ?? null, id]);
        await reconcileMediaTrip(client, id);
      });
    }
    const updated = await loadMedia(req.user.familyId, id);
    return toDto(updated!);
  });

  app.delete("/api/media/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = await loadMedia(req.user.familyId, id);
    if (!row) return reply.code(404).send({ error: "Not found" });
    await query("DELETE FROM media WHERE id = $1", [id]);
    await deleteStored(row.rel_path);
    if (row.thumb_rel_path) await deleteStored(row.thumb_rel_path);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 5: Register the route in `index.ts`**

Add `import { mediaRoutes } from "./routes/media.js";` and `await app.register(mediaRoutes);`.

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/media.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/reconcile.ts backend/src/routes/media.ts backend/src/routes/media.test.ts backend/src/index.ts backend/package.json
git commit -m "feat(media): upload, serve, and move-on-trip reconciler"
```

---

## Task 13: Visits routes (replaces items.ts)

**Files:**
- Create: `backend/src/routes/visits.ts`
- Delete: `backend/src/routes/items.ts`
- Test: `backend/src/routes/visits.test.ts`

This ports `items.ts` to the new model: visits are **family-scoped and standalone** (no `map_set_id`); waypoints become `visit_waypoints`; comments become `comments` (now living on visits). Map membership is handled in Task 14. Photos are **not** attached here anymore — media links to visits via the links API (Task 11).

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/visits.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates, reads, updates, and deletes a visit", async () => {
  const create = await ctx.app.inject({
    method: "POST", url: "/api/visits", headers: auth(),
    payload: {
      kind: "food", title: "Joe's Pizza",
      geometry: { type: "Point", coordinates: [-74, 40.7] },
      occurredOn: "2024-05-01",
    },
  });
  expect(create.statusCode).toBe(201);
  const id = create.json().id;
  expect(create.json().title).toBe("Joe's Pizza");

  const get = await ctx.app.inject({ method: "GET", url: `/api/visits/${id}`, headers: auth() });
  expect(get.json().geometry).toEqual({ type: "Point", coordinates: [-74, 40.7] });

  const patch = await ctx.app.inject({
    method: "PATCH", url: `/api/visits/${id}`, headers: auth(), payload: { title: "Joe's" },
  });
  expect(patch.json().title).toBe("Joe's");

  const del = await ctx.app.inject({ method: "DELETE", url: `/api/visits/${id}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});

test("lists visits scoped to the family", async () => {
  await ctx.app.inject({
    method: "POST", url: "/api/visits", headers: auth(),
    payload: { kind: "place", title: "Tower" },
  });
  const list = await ctx.app.inject({ method: "GET", url: "/api/visits", headers: auth() });
  expect(list.statusCode).toBe(200);
  expect(Array.isArray(list.json())).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/visits.test.ts`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement `visits.ts`**

Create `backend/src/routes/visits.ts` (ported from `items.ts`, adapted to the new schema):
```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

const geometrySchema = z.object({ type: z.enum(["Point", "LineString"]), coordinates: z.any() }).nullable();
const waypointSchema = z.object({
  label: z.string().min(1).max(200),
  kind: z.enum(["origin", "stop", "destination", "port"]).default("stop"),
  lng: z.number(), lat: z.number(), seq: z.number().int().optional(),
  arriveAt: z.string().datetime().nullish(), departAt: z.string().datetime().nullish(),
});
const visitSchema = z.object({
  kind: z.enum(["place", "food", "flight", "cruise", "drive", "stay", "custom"]),
  title: z.string().min(1).max(200),
  notes: z.string().max(20000).optional(),
  themeId: z.string().uuid().nullish(),
  tripId: z.string().uuid().nullish(),
  color: z.string().max(40).nullish(),
  icon: z.string().max(200).nullish(),
  occurredOn: z.string().nullish(),
  occurredEnd: z.string().nullish(),
  properties: z.record(z.unknown()).optional(),
  geometry: geometrySchema.optional(),
  waypoints: z.array(waypointSchema).optional(),
});

async function ownsVisit(familyId: string, id: string): Promise<boolean> {
  const { rowCount } = await query("SELECT 1 FROM visits WHERE id = $1 AND family_id = $2", [id, familyId]);
  return Boolean(rowCount);
}

async function loadVisit(familyId: string, id: string) {
  const { rows } = await query<any>(
    `SELECT v.id, v.trip_id, v.kind, v.title, v.notes, v.theme_id, v.color, v.icon,
            v.occurred_on, v.occurred_end, v.properties, v.created_by, v.created_at,
            u.display_name AS created_by_name, ST_AsGeoJSON(v.geom) AS geom
     FROM visits v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.id = $1 AND v.family_id = $2`,
    [id, familyId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  const wps = await query<any>(
    `SELECT id, label, kind, seq, arrive_at, depart_at, ST_X(geom) AS lng, ST_Y(geom) AS lat
     FROM visit_waypoints WHERE visit_id = $1 ORDER BY seq ASC`, [id],
  );
  return {
    id: r.id, tripId: r.trip_id, kind: r.kind, title: r.title, notes: r.notes,
    themeId: r.theme_id, color: r.color, icon: r.icon,
    occurredOn: r.occurred_on, occurredEnd: r.occurred_end, properties: r.properties,
    createdBy: r.created_by, createdByName: r.created_by_name, createdAt: r.created_at,
    geometry: r.geom ? JSON.parse(r.geom) : null,
    waypoints: wps.rows.map((w) => ({
      id: w.id, label: w.label, kind: w.kind, seq: w.seq, lng: w.lng, lat: w.lat,
      arriveAt: w.arrive_at, departAt: w.depart_at,
    })),
  };
}

async function insertWaypoints(client: PoolClient, visitId: string, waypoints: z.infer<typeof waypointSchema>[]): Promise<void> {
  for (let i = 0; i < waypoints.length; i++) {
    const w = waypoints[i];
    await client.query(
      `INSERT INTO visit_waypoints (visit_id, label, kind, seq, geom, arrive_at, depart_at)
       VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($5,$6),4326), $7,$8)`,
      [visitId, w.label, w.kind, w.seq ?? i, w.lng, w.lat, w.arriveAt ?? null, w.departAt ?? null],
    );
  }
}

export async function visitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/visits", async (req) => {
    const { rows } = await query<{ id: string }>(
      "SELECT id FROM visits WHERE family_id = $1 ORDER BY occurred_on NULLS LAST, created_at ASC",
      [req.user.familyId],
    );
    return Promise.all(rows.map((r) => loadVisit(req.user.familyId, r.id)));
  });

  app.post("/api/visits", async (req, reply) => {
    const parsed = visitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const id = await tx(async (client) => {
      const geomJson = b.geometry ? JSON.stringify(b.geometry) : null;
      const res = await client.query<{ id: string }>(
        `INSERT INTO visits (family_id, trip_id, kind, title, notes, theme_id, color, icon, occurred_on, occurred_end, geom, created_by, properties)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           CASE WHEN $11::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($11),4326) END,
           $12, COALESCE($13::jsonb,'{}'::jsonb))
         RETURNING id`,
        [req.user.familyId, b.tripId ?? null, b.kind, b.title, b.notes ?? "", b.themeId ?? null,
         b.color ?? null, b.icon ?? null, b.occurredOn ?? null, b.occurredEnd ?? null, geomJson,
         req.user.id, b.properties ? JSON.stringify(b.properties) : null],
      );
      const vid = res.rows[0].id;
      if (b.waypoints?.length) await insertWaypoints(client, vid, b.waypoints);
      return vid;
    });
    return reply.code(201).send(await loadVisit(req.user.familyId, id));
  });

  app.get("/api/visits/:id", async (req, reply) => {
    const v = await loadVisit(req.user.familyId, (req.params as { id: string }).id);
    if (!v) return reply.code(404).send({ error: "Not found" });
    return v;
  });

  app.patch("/api/visits/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsVisit(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const parsed = visitSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    await tx(async (client) => {
      const geomProvided = Object.prototype.hasOwnProperty.call(b, "geometry");
      const geomJson = b.geometry ? JSON.stringify(b.geometry) : null;
      const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
      await client.query(
        `UPDATE visits SET
           kind = COALESCE($2, kind), title = COALESCE($3, title), notes = COALESCE($4, notes),
           theme_id = CASE WHEN $5::boolean THEN $6 ELSE theme_id END,
           color = CASE WHEN $7::boolean THEN $8 ELSE color END,
           icon = CASE WHEN $9::boolean THEN $10 ELSE icon END,
           occurred_on = CASE WHEN $11::boolean THEN $12 ELSE occurred_on END,
           occurred_end = CASE WHEN $13::boolean THEN $14 ELSE occurred_end END,
           trip_id = CASE WHEN $15::boolean THEN $16 ELSE trip_id END,
           geom = CASE WHEN $17::boolean THEN
             (CASE WHEN $18::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($18),4326) END)
             ELSE geom END,
           properties = CASE WHEN $19::boolean THEN COALESCE($20::jsonb,'{}'::jsonb) ELSE properties END,
           updated_at = now()
         WHERE id = $1`,
        [id, b.kind ?? null, b.title ?? null, b.notes ?? null,
         has("themeId"), b.themeId ?? null, has("color"), b.color ?? null,
         has("icon"), b.icon ?? null, has("occurredOn"), b.occurredOn ?? null,
         has("occurredEnd"), b.occurredEnd ?? null, has("tripId"), b.tripId ?? null,
         geomProvided, geomJson, has("properties"), b.properties ? JSON.stringify(b.properties) : null],
      );
      if (b.waypoints) {
        await client.query("DELETE FROM visit_waypoints WHERE visit_id = $1", [id]);
        await insertWaypoints(client, id, b.waypoints);
      }
    });
    return loadVisit(req.user.familyId, id);
  });

  app.delete("/api/visits/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsVisit(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    await query("DELETE FROM visits WHERE id = $1", [id]);
    return reply.code(204).send();
  });

  // --- Comments (now on visits) ---
  app.get("/api/visits/:id/comments", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsVisit(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const { rows } = await query<any>(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.display_name AS author
       FROM comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.visit_id = $1 ORDER BY c.created_at ASC`, [id],
    );
    return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at, userId: r.user_id, author: r.author }));
  });

  app.post("/api/visits/:id/comments", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsVisit(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const parsed = z.object({ body: z.string().min(1).max(4000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { rows } = await query<any>(
      `INSERT INTO comments (visit_id, user_id, body) VALUES ($1,$2,$3)
       RETURNING id, body, created_at, user_id`, [id, req.user.id, parsed.data.body],
    );
    const r = rows[0];
    return reply.code(201).send({ id: r.id, body: r.body, createdAt: r.created_at, userId: r.user_id });
  });

  app.delete("/api/comments/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query(
      `DELETE FROM comments c USING visits v
       WHERE c.id = $1 AND c.visit_id = v.id AND v.family_id = $2 AND c.user_id = $3`,
      [id, req.user.familyId, req.user.id],
    );
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Swap the route registration in `index.ts`**

In `backend/src/index.ts`: remove `import { itemRoutes } from "./routes/items.js";` and its `await app.register(itemRoutes);`, and add `import { visitRoutes } from "./routes/visits.js";` + `await app.register(visitRoutes);`.

- [ ] **Step 5: Delete the old items route**

Run:
```bash
git rm backend/src/routes/items.ts
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/visits.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/visits.ts backend/src/routes/visits.test.ts backend/src/index.ts
git commit -m "feat(visits): family-scoped visits replacing items"
```

---

## Task 14: Map-set membership + trips refactor + index wiring

**Files:**
- Modify: `backend/src/routes/mapsets.ts`, `backend/src/routes/trips.ts`, `backend/src/index.ts`
- Test: `backend/src/routes/mapsets.test.ts`

- [ ] **Step 1: Write the failing membership test**

Create `backend/src/routes/mapsets.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("adds a visit to a map set and lists it", async () => {
  const ms = await query<{ id: string }>(
    "INSERT INTO map_sets (family_id, name) VALUES ($1,'Main') RETURNING id", [ctx.familyId]);
  const v = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title) VALUES ($1,'place','Tower') RETURNING id", [ctx.familyId]);

  const add = await ctx.app.inject({
    method: "POST", url: `/api/map-sets/${ms.rows[0].id}/visits`,
    headers: auth(), payload: { visitId: v.rows[0].id },
  });
  expect(add.statusCode).toBe(201);

  const list = await ctx.app.inject({
    method: "GET", url: `/api/map-sets/${ms.rows[0].id}/visits`, headers: auth() });
  expect(list.json()).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/mapsets.test.ts`
Expected: FAIL (route missing).

- [ ] **Step 3: Add membership endpoints to `mapsets.ts`**

Append inside `mapSetRoutes` in `backend/src/routes/mapsets.ts`, before the closing brace:
```ts
  // --- Map ↔ visit membership ---
  async function ownsMapSet(familyId: string, id: string): Promise<boolean> {
    const { rowCount } = await query("SELECT 1 FROM map_sets WHERE id = $1 AND family_id = $2", [id, familyId]);
    return Boolean(rowCount);
  }

  app.get("/api/map-sets/:id/visits", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsMapSet(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const { rows } = await query<{ visit_id: string; seq: number }>(
      "SELECT visit_id, seq FROM map_set_visits WHERE map_set_id = $1 ORDER BY seq ASC", [id]);
    return rows.map((r) => ({ visitId: r.visit_id, seq: r.seq }));
  });

  app.post("/api/map-sets/:id/visits", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsMapSet(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const parsed = z.object({ visitId: z.string().uuid(), seq: z.number().int().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const owns = await query("SELECT 1 FROM visits WHERE id = $1 AND family_id = $2", [parsed.data.visitId, req.user.familyId]);
    if (!owns.rowCount) return reply.code(404).send({ error: "Visit not found" });
    await query(
      `INSERT INTO map_set_visits (map_set_id, visit_id, seq) VALUES ($1,$2,$3)
       ON CONFLICT (map_set_id, visit_id) DO UPDATE SET seq = EXCLUDED.seq`,
      [id, parsed.data.visitId, parsed.data.seq ?? 0]);
    return reply.code(201).send({ ok: true });
  });

  app.delete("/api/map-sets/:id/visits/:visitId", async (req, reply) => {
    const { id, visitId } = req.params as { id: string; visitId: string };
    if (!(await ownsMapSet(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    await query("DELETE FROM map_set_visits WHERE map_set_id = $1 AND visit_id = $2", [id, visitId]);
    return reply.code(204).send();
  });
```

- [ ] **Step 4: Refactor `trips.ts` to be family-scoped**

In `backend/src/routes/trips.ts`, replace the map-set-scoped endpoints. Change the list/create to operate on the family and drop `map_set_id` from the schema, DTO, and SQL:
- Remove `mapSetId` from `upsertSchema` and `ownsMapSet`.
- Remove `map_set_id` from `TripRow` and `toDto`.
- `GET /api/trips` → `SELECT * FROM trips WHERE family_id = $1 ORDER BY start_date NULLS LAST, created_at ASC` with `[req.user.familyId]`.
- `POST /api/trips` → `INSERT INTO trips (family_id, name, description, start_date, end_date, cover_photo_url, color, created_by) VALUES ($1..$8)`.
- `PATCH`/`DELETE /api/trips/:id` → scope by `family_id = $2` directly (drop the `map_sets` join):
  ```ts
  // DELETE
  const res = await query("DELETE FROM trips WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
  ```
  ```ts
  // PATCH — replace the FROM map_sets join with a direct family scope:
  // ... WHERE id = $1 AND family_id = $2 RETURNING *
  ```

Full replacement for `trips.ts`:
```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

const upsertSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(4000).optional(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  coverPhotoUrl: z.string().nullish(),
  color: z.string().max(40).optional(),
});

interface TripRow {
  id: string; name: string; description: string;
  start_date: string | null; end_date: string | null;
  cover_photo_url: string | null; color: string; created_at: string;
}
const toDto = (r: TripRow) => ({
  id: r.id, name: r.name, description: r.description,
  startDate: r.start_date, endDate: r.end_date,
  coverPhotoUrl: r.cover_photo_url, color: r.color, createdAt: r.created_at,
});

export async function tripRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/trips", async (req) => {
    const { rows } = await query<TripRow>(
      "SELECT * FROM trips WHERE family_id = $1 ORDER BY start_date NULLS LAST, created_at ASC",
      [req.user.familyId]);
    return rows.map(toDto);
  });

  app.post("/api/trips", async (req, reply) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const { rows } = await query<TripRow>(
      `INSERT INTO trips (family_id, name, description, start_date, end_date, cover_photo_url, color, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.familyId, b.name, b.description ?? "", b.startDate || null, b.endDate || null,
       b.coverPhotoUrl ?? null, b.color ?? "#2563eb", req.user.id]);
    return reply.code(201).send(toDto(rows[0]));
  });

  app.patch("/api/trips/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = upsertSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    const { rows } = await query<TripRow>(
      `UPDATE trips SET
         name = COALESCE($3, name), description = COALESCE($4, description),
         start_date = CASE WHEN $5::boolean THEN $6 ELSE start_date END,
         end_date = CASE WHEN $7::boolean THEN $8 ELSE end_date END,
         cover_photo_url = CASE WHEN $9::boolean THEN $10 ELSE cover_photo_url END,
         color = COALESCE($11, color)
       WHERE id = $1 AND family_id = $2 RETURNING *`,
      [id, req.user.familyId, b.name ?? null, b.description ?? null,
       has("startDate"), b.startDate || null, has("endDate"), b.endDate || null,
       has("coverPhotoUrl"), b.coverPhotoUrl ?? null, b.color ?? null]);
    if (!rows[0]) return reply.code(404).send({ error: "Not found" });
    return toDto(rows[0]);
  });

  app.delete("/api/trips/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM trips WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });
}
```

> **Reconcile-on-trip-rename:** when a trip's `name`/`start_date` changes, its folder slug changes. For 1A this is acceptable to defer to a follow-up (files keep their old-slug folder until touched). Add a `// TODO(phase-1b): re-home media on trip rename` comment in the PATCH handler so it's explicit. *(This is the one deliberate deferral; it does not break correctness — `media.rel_path` still points at the real file.)*

- [ ] **Step 5: Verify `index.ts` registrations**

Confirm `backend/src/index.ts` registers `visitRoutes`, `mediaRoutes`, `linkRoutes`, `fileRoutes` (added in Tasks 9–13) and no longer references `itemRoutes`. Fix any missing registration now.

- [ ] **Step 6: Run the membership test + full typecheck**

Run:
```bash
cd backend && npm test -- src/routes/mapsets.test.ts && npm run typecheck
```
Expected: membership test PASS; `typecheck` reports errors only in the not-yet-ported aux routes (Task 15) — note them for the next task.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/mapsets.ts backend/src/routes/trips.ts backend/src/routes/mapsets.test.ts backend/src/index.ts
git commit -m "feat(map): map↔visit membership; family-scoped trips; wire new routes"
```

---

## Task 15: Port auxiliary routes (stats, export, import, share)

These four still reference `items`/`item_photos`. Port each to `visits`/`media`. Keeping the app compiling and the Map share view working.

**Files:**
- Modify: `backend/src/routes/stats.ts`, `export.ts`, `import.ts`, `share.ts`
- Test: `backend/src/routes/aux.test.ts`

- [ ] **Step 1: Read each file and apply these substitutions**

For **`stats.ts`** and any aggregate queries:
- `FROM items i JOIN map_sets m ON m.id = i.map_set_id WHERE m.family_id = $1` → `FROM visits v WHERE v.family_id = $1`.
- `items` → `visits`; `item_photos` → `media`; `i.occurred_on` → `v.occurred_on`; `kind` column unchanged.
- Counting photos: `SELECT count(*) FROM item_photos` → `SELECT count(*) FROM media WHERE family_id = $1`.

For **`export.ts`**:
- Replace the item/photo selection with `visits` (+ `ST_AsGeoJSON(geom)`) scoped by `family_id`, and `visit_waypoints` for waypoints.
- Photos in the export: select from `media` linked to each visit via `links` (`from_type/to_type` of `media`/`visit`), exposing `signFileUrl(rel_path)` for URLs (import `signFileUrl` from `../lib/filesign.js`).

For **`import.ts`**:
- Insert parsed features into `visits` (`family_id`, `kind`, `title`, `geom`, ...) instead of `items`; if the importer assigned items to a map set, also insert a `map_set_visits` row.

For **`share.ts`**:
- The public share view reads a map set's pins. Replace the `items` query with: visits that are members of the shared map set —
  ```sql
  SELECT v.* FROM visits v
  JOIN map_set_visits msv ON msv.visit_id = v.id
  WHERE msv.map_set_id = $1
  ```
- For each visit's photos, select from `media` via `links` and expose `signFileUrl(rel_path)` so shared images load. *(Signed URLs work without a session, which is what the public share view needs.)*

- [ ] **Step 2: Write a smoke test for stats, export, and the public share**

The stats route becomes **family-scoped at `/api/stats`** (no `mapSetId`), matching Plan 1B's `getStats`. Create `backend/src/routes/aux.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await buildTestApp();
  await query("INSERT INTO visits (family_id, kind, title, occurred_on) VALUES ($1,'place','A','2024-01-01')", [ctx.familyId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("stats endpoint returns counts over visits", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/stats", headers: auth() });
  expect(res.statusCode).toBe(200);
  expect(res.json().items).toBe(1);
});

test("export includes visits", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/export", headers: auth() });
  expect(res.statusCode).toBe(200);
  expect(Array.isArray(res.json().visits)).toBe(true);
  expect(res.json().visits.length).toBeGreaterThanOrEqual(1);
});

test("public share returns a map's member visits with a photos array", async () => {
  const ms = await query<{ id: string }>(
    "INSERT INTO map_sets (family_id, name) VALUES ($1,'M') RETURNING id", [ctx.familyId]);
  const v = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title) VALUES ($1,'food','B') RETURNING id", [ctx.familyId]);
  await query("INSERT INTO map_set_visits (map_set_id, visit_id) VALUES ($1,$2)", [ms.rows[0].id, v.rows[0].id]);

  const share = await ctx.app.inject({
    method: "POST", url: `/api/map-sets/${ms.rows[0].id}/shares`, headers: auth() });
  const token = share.json().token;
  const res = await ctx.app.inject({ method: "GET", url: `/api/share/${token}` });
  expect(res.statusCode).toBe(200);
  expect(res.json().items).toHaveLength(1);
  expect(Array.isArray(res.json().items[0].photos)).toBe(true);
});
```

- [ ] **Step 3: Run to verify it fails, then port until it passes**

Run: `cd backend && npm test -- src/routes/aux.test.ts`
Iterate on the four files until the test passes and `npm run typecheck` is clean.

- [ ] **Step 4: Full typecheck**

Run: `cd backend && npm run typecheck`
Expected: **no errors** (whole backend compiles).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/stats.ts backend/src/routes/export.ts backend/src/routes/import.ts backend/src/routes/share.ts backend/src/routes/aux.test.ts
git commit -m "refactor: port stats/export/import/share onto visits + media"
```

---

## Task 16: Seed fake data in the new shape

**Files:**
- Modify: `backend/src/db/seed.ts`

- [ ] **Step 1: Add a dev-data seeding function**

In `backend/src/db/seed.ts`, add after `seedThemes()` a `seedDevData()` that creates one family, an owner user (bcrypt-hashed password), a map set, a couple of trips, several visits (some with `trip_id`, some loose), and a `map_set_visits` membership. Call it from `seed()` only when `SEED_DEV_DATA=true`:

```ts
import { hashPassword } from "../lib/auth.js";

async function seedDevData(): Promise<void> {
  if (process.env.SEED_DEV_DATA !== "true") return;
  const fam = await pool.query<{ id: string }>(
    "INSERT INTO families (name, invite_code) VALUES ('The Wanderers', 'wander-1') RETURNING id");
  const familyId = fam.rows[0].id;
  const pass = await hashPassword("password123");
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (family_id, email, display_name, password_hash, role)
     VALUES ($1,'demo@werejugo.dev','Demo',$2,'owner') RETURNING id`, [familyId, pass]);
  const userId = user.rows[0].id;
  const ms = await pool.query<{ id: string }>(
    "INSERT INTO map_sets (family_id, name, created_by) VALUES ($1,'Our Travels',$2) RETURNING id",
    [familyId, userId]);
  const trip = await pool.query<{ id: string }>(
    "INSERT INTO trips (family_id, name, start_date, created_by) VALUES ($1,'Italy 2024','2024-06-01',$2) RETURNING id",
    [familyId, userId]);
  const v1 = await pool.query<{ id: string }>(
    `INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, geom, created_by)
     VALUES ($1,$2,'place','Colosseum','2024-06-02', ST_SetSRID(ST_MakePoint(12.4924,41.8902),4326), $3) RETURNING id`,
    [familyId, trip.rows[0].id, userId]);
  await pool.query(
    `INSERT INTO visits (family_id, kind, title, occurred_on, geom, created_by)
     VALUES ($1,'food','Joe''s Pizza','2024-03-10', ST_SetSRID(ST_MakePoint(-73.99,40.73),4326), $2)`,
    [familyId, userId]);
  await pool.query("INSERT INTO map_set_visits (map_set_id, visit_id) VALUES ($1,$2)", [ms.rows[0].id, v1.rows[0].id]);
  console.log("[seed] dev data created (login: demo@werejugo.dev / password123)");
}

// In seed():
//   await seedReference();
//   await seedThemes();
//   await seedDevData();
```
Add the `await seedDevData();` call to the existing `seed()` function.

- [ ] **Step 2: Verify the seed runs**

Run:
```bash
cd backend && SEED_DEV_DATA=true npm run seed
```
Expected: reference + themes + `[seed] dev data created ...`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/seed.ts
git commit -m "feat(seed): optional dev data in the new shared-core shape"
```

---

## Task 17: Full backend verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `cd backend && npm test`
Expected: all test files PASS.

- [ ] **Step 2: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Boot the server against a clean DB**

Run:
```bash
cd backend && npm run migrate && SEED_DEV_DATA=true npm run seed && npm run dev
```
Expected: server listens on the configured port; `GET /api/health` returns `{ ok: true }`; logging in as `demo@werejugo.dev` / `password123` and `GET /api/visits` returns the two seeded visits.

- [ ] **Step 4: Commit (if any incidental fixes were needed)**

```bash
git add -A backend
git commit -m "chore: phase 1A backend foundation verified end-to-end" || echo "nothing to commit"
```

---

## Notes for Plan 1B (frontend)

Plan 1B will consume these APIs:
- `media` DTOs carry signed `url`/`thumbUrl` (good for `<img>` directly).
- Map data now comes from `GET /api/map-sets/:id/visits` (membership) + `GET /api/visits/:id`.
- Cross-entity connections use `POST/GET/DELETE /api/links`; the `RelatedPanel` component is the standard UI for them.
- Trips are family-scoped (`/api/trips`), no longer nested under a map set.
- The frontend `api/client.ts` and `MapPage.tsx` need updating from the old `/api/map-sets/:id/items` + `/api/items/:id/photos` shapes to visits + media + links.
