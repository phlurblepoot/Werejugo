# Phase 8A — Polish Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend for the final polish phase — global cross-type search, generalized read-only sharing (trips + albums, maps retired), and full-archive backup & restore.

**Architecture:** Three independent slices on the existing Fastify + `pg` stack. Search reuses the per-type ILIKE queries already in `relations.ts`, grouped into one response. Sharing repurposes the existing `share_links`/token plumbing: a migration generalizes the target from `map_set_id` to `(target_type, target_id)` with a `trip|album` allow-list. Backup serializes every application table to JSON via `to_jsonb` (geometry included automatically) and packs it with the storage tree into a `.tar.gz` using `node-tar`; restore truncates and reinserts via `jsonb_populate_recordset` in FK-safe order inside one transaction.

**Tech Stack:** Fastify 5 (ESM, `.js` import suffixes), PostgreSQL 16 + PostGIS via `pg`, `nanoid` tokens, `node-tar`, Vitest against the live `werejugo_test` DB.

**Conventions (read before starting):**
- Backend commands run from `backend/`.
- Tests use `buildTestApp`/`closeTestApp`/`query` from `src/test/helpers.js` and `app.inject`.
- Never fabricate test output. Never weaken or delete a behavioral assertion to make a test pass. Test-mechanism fixes are fine; if a test reveals a real problem, STOP and report it.
- Commit after each task with the exact message shown. Stage only the files that task touched (there are unrelated modified files in the tree — never `git add -A`).

---

### Task 1: Global search endpoint `GET /api/search`

**Files:**
- Create: `backend/src/routes/search.ts`
- Modify: `backend/src/index.ts` (import + register)
- Test: `backend/src/routes/search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/search.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;

beforeAll(async () => {
  ctx = await buildTestApp();
  const fam = ctx.familyId;
  await query("INSERT INTO trips (family_id, name, created_by) VALUES ($1,'Venice Trip',$2)", [fam, ctx.userId]);
  await query("INSERT INTO visits (family_id, kind, title, created_by) VALUES ($1,'place','Venice Visit',$2)", [fam, ctx.userId]);
  await query("INSERT INTO people (family_id, display_name) VALUES ($1,'Venice Person')", [fam]);
  await query(
    "INSERT INTO media (family_id, kind, rel_path, original_name, caption, created_by) VALUES ($1,'image','loose/2024/venice.jpg','venice.jpg','Venice photo',$2)",
    [fam, ctx.userId]);
  await query("INSERT INTO documents (family_id, title, doc_type) VALUES ($1,'Venice Passport','passport')", [fam]);

  // A second family whose data must never leak into the first family's results.
  const fam2 = (await query<{ id: string }>(
    "INSERT INTO families (name, invite_code) VALUES ('Other','inv-other') RETURNING id")).rows[0].id;
  await query("INSERT INTO trips (family_id, name) VALUES ($1,'Venice Foreign')", [fam2]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("groups matches across all core types", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/search?q=Venice", headers: auth() });
  expect(res.statusCode).toBe(200);
  const b = res.json();
  expect(b.trips.map((r: any) => r.label)).toEqual(["Venice Trip"]);
  expect(b.visits.map((r: any) => r.label)).toEqual(["Venice Visit"]);
  expect(b.people.map((r: any) => r.label)).toEqual(["Venice Person"]);
  expect(b.photos.map((r: any) => r.label)).toEqual(["Venice photo"]);
  expect(b.documents.map((r: any) => r.label)).toEqual(["Venice Passport"]);
  // navigation target is computed server-side
  expect(b.trips[0].to).toBe(`/planning?trip=${b.trips[0].id}`);
});

test("never leaks another family's rows", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/search?q=Venice", headers: auth() });
  const names = res.json().trips.map((r: any) => r.label);
  expect(names).not.toContain("Venice Foreign");
});

test("empty query returns empty groups", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/search?q=", headers: auth() });
  expect(res.json()).toEqual({ people: [], trips: [], visits: [], photos: [], documents: [] });
});

test("requires auth", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/search?q=Venice" });
  expect(res.statusCode).toBe(401);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- search`
Expected: FAIL — route not registered (404 / cannot find `/api/search`).

- [ ] **Step 3: Implement the route**

Create `backend/src/routes/search.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { signFileUrl } from "../lib/filesign.js";

interface Hit { type: string; id: string; label: string; thumbUrl: string | null; to: string }

const PER_GROUP = 6;

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/search", async (req) => {
    const fam = req.user.familyId;
    const term = ((req.query as { q?: string }).q ?? "").trim();
    const empty = { people: [], trips: [], visits: [], photos: [], documents: [] };
    if (term.length === 0) return empty;
    const like = `%${term}%`;

    const trips = (await query<any>(
      "SELECT id, name FROM trips WHERE family_id = $1 AND name ILIKE $2 ORDER BY name ASC LIMIT $3",
      [fam, like, PER_GROUP])).rows.map<Hit>((r) => ({ type: "trip", id: r.id, label: r.name, thumbUrl: null, to: `/planning?trip=${r.id}` }));

    const visits = (await query<any>(
      "SELECT id, title FROM visits WHERE family_id = $1 AND title ILIKE $2 ORDER BY title ASC LIMIT $3",
      [fam, like, PER_GROUP])).rows.map<Hit>((r) => ({ type: "visit", id: r.id, label: r.title, thumbUrl: null, to: `/map?visit=${r.id}` }));

    const people = (await query<any>(
      `SELECT p.id, p.display_name, m.rel_path, m.thumb_rel_path
       FROM people p LEFT JOIN media m ON m.id = p.avatar_media_id
       WHERE p.family_id = $1 AND p.display_name ILIKE $2 ORDER BY p.display_name ASC LIMIT $3`,
      [fam, like, PER_GROUP])).rows.map<Hit>((r) => {
        const rel = r.thumb_rel_path ?? r.rel_path;
        return { type: "person", id: r.id, label: r.display_name, thumbUrl: rel ? signFileUrl(rel) : null, to: `/people?person=${r.id}` };
      });

    const photos = (await query<any>(
      `SELECT id, caption, original_name, rel_path, thumb_rel_path FROM media
       WHERE family_id = $1 AND (caption ILIKE $2 OR original_name ILIKE $2) ORDER BY created_at DESC LIMIT $3`,
      [fam, like, PER_GROUP])).rows.map<Hit>((r) => {
        const rel = r.thumb_rel_path ?? r.rel_path;
        return { type: "media", id: r.id, label: r.caption || r.original_name || "Photo", thumbUrl: rel ? signFileUrl(rel) : null, to: `/photos?photo=${r.id}` };
      });

    const documents = (await query<any>(
      "SELECT id, title FROM documents WHERE family_id = $1 AND title ILIKE $2 ORDER BY title ASC LIMIT $3",
      [fam, like, PER_GROUP])).rows.map<Hit>((r) => ({ type: "document", id: r.id, label: r.title, thumbUrl: null, to: `/documents?doc=${r.id}` }));

    return { people, trips, visits, photos, documents };
  });
}
```

- [ ] **Step 4: Register the route**

In `backend/src/index.ts`, add the import next to the other route imports:

```ts
import { searchRoutes } from "./routes/search.js";
```

and register it next to `relationRoutes`:

```ts
  await app.register(searchRoutes);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- search`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/search.ts backend/src/routes/search.test.ts backend/src/index.ts
git commit -m "feat(search): grouped cross-type /api/search"
```

---

### Task 2: Generalize `share_links` (migration 0011)

**Files:**
- Create: `backend/src/db/migrations/0011_generalize_share_links.sql`
- Test: `backend/src/db/share-links-schema.test.ts`

Maps are no longer shareable. There are no real shares to preserve (greenfield), so the migration clears the table, drops the `map_set_id` column, and adds a `(target_type, target_id)` target with a `trip|album` allow-list.

- [ ] **Step 1: Write the failing test**

Create `backend/src/db/share-links-schema.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "./pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

test("share_links has target columns and no map_set_id", async () => {
  const cols = (await query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'share_links'")).rows.map((r) => r.column_name);
  expect(cols).toContain("target_type");
  expect(cols).toContain("target_id");
  expect(cols).not.toContain("map_set_id");
});

test("target_type allow-list rejects unknown types", async () => {
  await expect(
    query("INSERT INTO share_links (token, target_type, target_id, family_id) VALUES ('tok1','mapset',$1,$2)",
      ["00000000-0000-0000-0000-000000000000", ctx.familyId]),
  ).rejects.toThrow();
});

test("a trip target inserts cleanly", async () => {
  const tripId = (await query<{ id: string }>(
    "INSERT INTO trips (family_id, name) VALUES ($1,'T') RETURNING id", [ctx.familyId])).rows[0].id;
  const res = await query("INSERT INTO share_links (token, target_type, target_id, family_id) VALUES ('tok2','trip',$1,$2)",
    [tripId, ctx.familyId]);
  expect(res.rowCount).toBe(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- share-links-schema`
Expected: FAIL — `map_set_id` still present / `target_type` missing.

- [ ] **Step 3: Write the migration**

Create `backend/src/db/migrations/0011_generalize_share_links.sql`:

```sql
-- Generalize share links from map sets to trips/albums. Maps are no longer
-- shareable; there are no real shares to preserve, so clear and retarget.
DELETE FROM share_links;
ALTER TABLE share_links DROP COLUMN map_set_id;
ALTER TABLE share_links ADD COLUMN target_type TEXT NOT NULL;
ALTER TABLE share_links ADD COLUMN target_id   UUID NOT NULL;
ALTER TABLE share_links ADD CONSTRAINT share_target_type_chk CHECK (target_type IN ('trip','album'));
CREATE INDEX idx_share_target ON share_links(target_type, target_id);
```

- [ ] **Step 4: Apply migrations to the test DB and run the test**

Run: `npm run migrate` (applies to dev DB) then `npm test -- share-links-schema`

> The test harness applies pending migrations to `werejugo_test` in `globalSetup` before tests run, so running the test is sufficient to apply 0011 there.

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0011_generalize_share_links.sql backend/src/db/share-links-schema.test.ts
git commit -m "feat(db): generalize share_links to trip/album targets"
```

---

### Task 3: Share management routes (create / list / delete), retargeted

**Files:**
- Modify: `backend/src/routes/share.ts` (replace the management section; rewrite ownership helper)
- Test: `backend/src/routes/share-manage.test.ts`

The public read route is rewritten in Task 4 — in this task, leave the existing `GET /api/share/:token` handler in place but stop relying on `map_set_id` by having it reference the new columns minimally is **not** required yet; Task 4 replaces it wholesale. To keep the file compiling between tasks, this task replaces the **management** routes and the ownership helper, and **temporarily** leaves the old public route returning 404 (it is fully implemented in Task 4).

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/share-manage.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  tripId = (await query<{ id: string }>(
    "INSERT INTO trips (family_id, name, created_by) VALUES ($1,'Italy',$2) RETURNING id", [ctx.familyId, ctx.userId])).rows[0].id;
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates a trip share and lists it", async () => {
  const c = await ctx.app.inject({ method: "POST", url: "/api/shares", headers: auth(),
    payload: { targetType: "trip", targetId: tripId } });
  expect(c.statusCode).toBe(201);
  expect(c.json().token).toHaveLength(20);

  const l = await ctx.app.inject({ method: "GET", url: `/api/shares?targetType=trip&targetId=${tripId}`, headers: auth() });
  expect(l.json()).toHaveLength(1);
});

test("creates an album share for a trip's gallery", async () => {
  const c = await ctx.app.inject({ method: "POST", url: "/api/shares", headers: auth(),
    payload: { targetType: "album", targetId: tripId } });
  expect(c.statusCode).toBe(201);
});

test("rejects an unknown target type", async () => {
  const c = await ctx.app.inject({ method: "POST", url: "/api/shares", headers: auth(),
    payload: { targetType: "mapset", targetId: tripId } });
  expect(c.statusCode).toBe(400);
});

test("rejects a target the family does not own", async () => {
  const fam2 = (await query<{ id: string }>(
    "INSERT INTO families (name, invite_code) VALUES ('Other','inv-x') RETURNING id")).rows[0].id;
  const foreign = (await query<{ id: string }>(
    "INSERT INTO trips (family_id, name) VALUES ($1,'Foreign') RETURNING id", [fam2])).rows[0].id;
  const c = await ctx.app.inject({ method: "POST", url: "/api/shares", headers: auth(),
    payload: { targetType: "trip", targetId: foreign } });
  expect(c.statusCode).toBe(404);
});

test("deletes a share", async () => {
  const c = await ctx.app.inject({ method: "POST", url: "/api/shares", headers: auth(),
    payload: { targetType: "trip", targetId: tripId } });
  const id = c.json().id;
  const d = await ctx.app.inject({ method: "DELETE", url: `/api/shares/${id}`, headers: auth() });
  expect(d.statusCode).toBe(204);
});

test("the old map-set share route is gone", async () => {
  const r = await ctx.app.inject({ method: "POST", url: "/api/map-sets/x/shares", headers: auth(), payload: {} });
  expect(r.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- share-manage`
Expected: FAIL — `/api/shares` does not exist; old map-set route still answers.

- [ ] **Step 3: Rewrite the management section of `share.ts`**

Replace the entire contents of `backend/src/routes/share.ts` with the following. (Task 4 fills in the public read route; for now it returns 404 so the file compiles and the management tests pass.)

```ts
import { customAlphabet } from "nanoid";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

const makeToken = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 20);

const createSchema = z.object({
  targetType: z.enum(["trip", "album"]),
  targetId: z.string().uuid(),
});

/** A trip and its album (its photo gallery) both resolve to a trip the family owns. */
async function ownsTarget(familyId: string, targetType: string, targetId: string): Promise<boolean> {
  // Both 'trip' and 'album' targets reference a trip id (an album is that trip's gallery).
  const { rowCount } = await query("SELECT 1 FROM trips WHERE id = $1 AND family_id = $2", [targetId, familyId]);
  return Boolean(rowCount);
}

export async function shareRoutes(app: FastifyInstance): Promise<void> {
  // --- Authenticated management ---

  app.post("/api/shares", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid share target" });
    const { targetType, targetId } = parsed.data;
    if (!(await ownsTarget(req.user.familyId, targetType, targetId))) {
      return reply.code(404).send({ error: "Target not found" });
    }
    const { rows } = await query<any>(
      `INSERT INTO share_links (token, target_type, target_id, family_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, token, target_type, target_id, created_at`,
      [makeToken(), targetType, targetId, req.user.familyId, req.user.id],
    );
    const r = rows[0];
    return reply.code(201).send({ id: r.id, token: r.token, targetType: r.target_type, targetId: r.target_id, createdAt: r.created_at });
  });

  app.get("/api/shares", { preHandler: requireAuth }, async (req, reply) => {
    const { targetType, targetId } = req.query as { targetType?: string; targetId?: string };
    if (!targetType || !targetId) return reply.code(400).send({ error: "targetType and targetId are required" });
    const { rows } = await query<any>(
      `SELECT id, token, target_type, target_id, created_at FROM share_links
       WHERE family_id = $1 AND target_type = $2 AND target_id = $3 ORDER BY created_at DESC`,
      [req.user.familyId, targetType, targetId],
    );
    return rows.map((r) => ({ id: r.id, token: r.token, targetType: r.target_type, targetId: r.target_id, createdAt: r.created_at }));
  });

  app.delete("/api/shares/:id", { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM share_links WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });

  // --- Public, read-only (no auth) --- implemented in Task 4
  app.get("/api/share/:token", async (_req, reply) => {
    return reply.code(404).send({ error: "Link not found or revoked" });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- share-manage`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/share.ts backend/src/routes/share-manage.test.ts
git commit -m "feat(share): trip/album share management (maps retired)"
```

---

### Task 4: Public share read route (trip + album payloads)

**Files:**
- Modify: `backend/src/routes/share.ts` (replace the public `GET /api/share/:token` stub)
- Test: `backend/src/routes/share-public.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/share-public.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string;
let tripToken: string;
let albumToken: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  tripId = (await query<{ id: string }>(
    "INSERT INTO trips (family_id, name, created_by) VALUES ($1,'Italy 2024',$2) RETURNING id", [ctx.familyId, ctx.userId])).rows[0].id;
  // a visit in the trip, with geometry, plus a linked photo
  const visitId = (await query<{ id: string }>(
    `INSERT INTO visits (family_id, trip_id, kind, title, geom, created_by)
     VALUES ($1,$2,'place','Colosseum', ST_SetSRID(ST_MakePoint(12.49,41.89),4326), $3) RETURNING id`,
    [ctx.familyId, tripId, ctx.userId])).rows[0].id;
  const mediaId = (await query<{ id: string }>(
    `INSERT INTO media (family_id, trip_id, kind, rel_path, original_name, created_by)
     VALUES ($1,$2,'image','trips/italy/photos/colosseum.jpg','colosseum.jpg',$3) RETURNING id`,
    [ctx.familyId, tripId, ctx.userId])).rows[0].id;
  await query(
    "INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role) VALUES ($1,'media',$2,'visit',$3,'appears_in')",
    [ctx.familyId, mediaId, visitId]);
  await query("INSERT INTO itinerary_items (family_id, trip_id, title, seq) VALUES ($1,$2,'Visit the Forum',0)", [ctx.familyId, tripId]);
  // a private document on the trip — must NEVER appear in a share payload
  await query("INSERT INTO documents (family_id, title, doc_type, owner_trip_id) VALUES ($1,'Booking','booking',$2)", [ctx.familyId, tripId]);

  tripToken = (await query<{ token: string }>(
    "INSERT INTO share_links (token, target_type, target_id, family_id) VALUES ('triptok123456789012','trip',$1,$2) RETURNING token",
    [tripId, ctx.familyId])).rows[0].token;
  albumToken = (await query<{ token: string }>(
    "INSERT INTO share_links (token, target_type, target_id, family_id) VALUES ('albmtok123456789012','album',$1,$2) RETURNING token",
    [tripId, ctx.familyId])).rows[0].token;
});
afterAll(async () => { await closeTestApp(ctx); });

test("a trip share returns trip, visits, itinerary, photos — and no documents", async () => {
  const res = await ctx.app.inject({ method: "GET", url: `/api/share/${tripToken}` });
  expect(res.statusCode).toBe(200);
  const b = res.json();
  expect(b.targetType).toBe("trip");
  expect(b.trip.name).toBe("Italy 2024");
  expect(b.visits).toHaveLength(1);
  expect(b.visits[0].geometry).toMatchObject({ type: "Point" });
  expect(b.visits[0].photos[0].url).toContain("sig=");
  expect(b.itinerary.map((i: any) => i.title)).toEqual(["Visit the Forum"]);
  expect(JSON.stringify(b)).not.toContain("Booking"); // documents never shared
});

test("an album share returns a flat photo list", async () => {
  const res = await ctx.app.inject({ method: "GET", url: `/api/share/${albumToken}` });
  expect(res.statusCode).toBe(200);
  const b = res.json();
  expect(b.targetType).toBe("album");
  expect(b.photos).toHaveLength(1);
  expect(b.photos[0].url).toContain("sig=");
});

test("an unknown token is 404", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/share/nope" });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- share-public`
Expected: FAIL — the stub returns 404 for valid tokens.

- [ ] **Step 3: Implement the public read route**

In `backend/src/routes/share.ts`, add this import at the top (next to the others):

```ts
import { signFileUrl } from "../lib/filesign.js";
```

Then replace the stub `app.get("/api/share/:token", ...)` with the full implementation:

```ts
  // --- Public, read-only (no auth) ---

  app.get("/api/share/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const link = await query<{ target_type: string; target_id: string; family_id: string }>(
      "SELECT target_type, target_id, family_id FROM share_links WHERE token = $1", [token]);
    if (!link.rows[0]) return reply.code(404).send({ error: "Link not found or revoked" });
    const { target_type: targetType, target_id: tripId, family_id: familyId } = link.rows[0];

    const photosOf = async (whereTripPhotos = true) => {
      const { rows } = await query<any>(
        `SELECT id, rel_path, thumb_rel_path, kind, caption FROM media
         WHERE family_id = $1 AND trip_id = $2 ORDER BY taken_at NULLS LAST, created_at ASC`,
        [familyId, tripId]);
      return rows.map((m, i) => ({
        id: m.id, url: signFileUrl(m.rel_path), thumbUrl: m.thumb_rel_path ? signFileUrl(m.thumb_rel_path) : null,
        mediaType: m.kind, caption: m.caption, seq: i,
      }));
    };

    const tripRow = await query<any>(
      "SELECT id, name, description, color, start_date, end_date FROM trips WHERE id = $1 AND family_id = $2",
      [tripId, familyId]);
    if (!tripRow.rows[0]) return reply.code(404).send({ error: "Link not found or revoked" });
    const t = tripRow.rows[0];
    const trip = { id: t.id, name: t.name, description: t.description, color: t.color, startDate: t.start_date, endDate: t.end_date };

    if (targetType === "album") {
      return { targetType, trip, photos: await photosOf() };
    }

    // trip share: visits (with geometry + their linked photos) + itinerary
    const visits = (await query<any>(
      `SELECT v.id, v.kind, v.title, v.notes, v.color, v.icon, v.occurred_on,
              ST_AsGeoJSON(v.geom) AS geom,
              COALESCE((SELECT json_agg(json_build_object('id', m.id, 'rel_path', m.rel_path,
                         'thumb_rel_path', m.thumb_rel_path, 'mediaType', m.kind, 'caption', m.caption) ORDER BY m.created_at)
                       FROM links l JOIN media m ON m.id = CASE WHEN l.from_type='media' THEN l.from_id ELSE l.to_id END
                       WHERE l.family_id = v.family_id
                         AND ((l.from_type='media' AND l.to_type='visit' AND l.to_id=v.id)
                           OR (l.to_type='media' AND l.from_type='visit' AND l.from_id=v.id))), '[]') AS photos
       FROM visits v WHERE v.trip_id = $1 AND v.family_id = $2
       ORDER BY v.occurred_on NULLS LAST, v.created_at ASC`,
      [tripId, familyId])).rows.map((r) => ({
        id: r.id, kind: r.kind, title: r.title, notes: r.notes, color: r.color, icon: r.icon, occurredOn: r.occurred_on,
        geometry: r.geom ? JSON.parse(r.geom) : null,
        photos: (r.photos as any[]).map((p, i) => ({
          id: p.id, url: signFileUrl(p.rel_path), thumbUrl: p.thumb_rel_path ? signFileUrl(p.thumb_rel_path) : null,
          mediaType: p.mediaType, caption: p.caption, seq: i,
        })),
      }));

    const itinerary = (await query<any>(
      "SELECT id, title, notes, scheduled_on, seq FROM itinerary_items WHERE trip_id = $1 AND family_id = $2 ORDER BY seq ASC",
      [tripId, familyId])).rows.map((r) => ({ id: r.id, title: r.title, notes: r.notes, scheduledOn: r.scheduled_on, seq: r.seq }));

    return { targetType, trip, visits, itinerary, photos: await photosOf() };
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- share-public`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/share.ts backend/src/routes/share-public.test.ts
git commit -m "feat(share): public trip/album read payloads (documents excluded)"
```

---

### Task 5: Backup download `GET /api/backup`

**Files:**
- Create: `backend/src/lib/archive.ts` (shared table list + dump/restore helpers)
- Create: `backend/src/routes/backup.ts` (`GET /api/backup`; restore added in Task 6)
- Modify: `backend/src/index.ts` (import + register)
- Modify: `backend/package.json` (add `tar` dependency)
- Test: `backend/src/routes/backup.test.ts`

- [ ] **Step 1: Add the `tar` dependency**

Run: `npm install tar@^7`
Expected: `package.json` gains `"tar": "^7.x"` under dependencies; lockfile updates.

- [ ] **Step 2: Write the failing test**

Create `backend/src/routes/backup.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { config } from "../config.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await buildTestApp();
  await query("INSERT INTO trips (family_id, name, created_by) VALUES ($1,'Backup Trip',$2)", [ctx.familyId, ctx.userId]);
  await mkdir(join(config.storageDir, "loose", "2024"), { recursive: true });
  await writeFile(join(config.storageDir, "loose", "2024", "photo.txt"), "hello-bytes");
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("backup is a gzip tar containing db.json, manifest.json and the storage tree", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/backup", headers: auth() });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("application/gzip");
  const buf = res.rawPayload;
  expect(buf[0]).toBe(0x1f); // gzip magic
  expect(buf[1]).toBe(0x8b);

  // extract and inspect
  const dir = await mkdtemp(join(tmpdir(), "bk-"));
  const tgz = join(dir, "b.tgz");
  await writeFile(tgz, buf);
  await tar.x({ file: tgz, cwd: dir });
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  expect(manifest.tables).toContain("trips");
  const db = JSON.parse(await readFile(join(dir, "db.json"), "utf8"));
  expect(db.trips.some((r: any) => r.name === "Backup Trip")).toBe(true);
  expect(await readFile(join(dir, "storage", "loose", "2024", "photo.txt"), "utf8")).toBe("hello-bytes");
  await rm(dir, { recursive: true, force: true });
});

test("requires auth", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/backup" });
  expect(res.statusCode).toBe(401);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- backup`
Expected: FAIL — `/api/backup` not registered.

- [ ] **Step 4: Implement the archive helpers**

Create `backend/src/lib/archive.ts`:

```ts
import { query } from "../db/pool.js";
import type pg from "pg";

/**
 * Every application table, in FK-safe INSERT order (parents before children).
 * Reference tables (airports/ports/spatial_ref_sys) and schema_migrations are
 * intentionally excluded — they are recreated by migrations/seed, not restored.
 */
export const BACKUP_TABLES = [
  "families", "users", "themes", "trips", "map_sets", "visits", "media", "people",
  "icons", "documents", "links", "map_set_visits", "visit_waypoints", "comments",
  "itinerary_items", "packing_lists", "packing_items", "blackout_periods", "share_links",
] as const;

/** Dump every table to a `{ [table]: rows[] }` object. Geometry is encoded as
 *  GeoJSON automatically by to_jsonb and round-trips via jsonb_populate_recordset. */
export async function dumpDatabase(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    const { rows } = await query<{ rows: unknown[] }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows FROM "${table}" t`);
    out[table] = rows[0].rows;
  }
  return out;
}

/** Wipe all application tables and reinsert the dump, in FK-safe order, atomically. */
export async function restoreDatabase(client: pg.PoolClient, db: Record<string, unknown[]>): Promise<Record<string, number>> {
  const tableList = BACKUP_TABLES.map((t) => `"${t}"`).join(", ");
  await client.query(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`);
  const counts: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    const rows = db[table] ?? [];
    if (rows.length > 0) {
      await client.query(
        `INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`,
        [JSON.stringify(rows)]);
    }
    counts[table] = rows.length;
  }
  return counts;
}
```

- [ ] **Step 5: Implement the backup route**

Create `backend/src/routes/backup.ts`:

```ts
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import * as tar from "tar";
import { requireAuth } from "../lib/auth.js";
import { config } from "../config.js";
import { BACKUP_TABLES, dumpDatabase } from "../lib/archive.js";

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/backup", { preHandler: requireAuth }, async (req, reply) => {
    const stage = await mkdtemp(join(tmpdir(), "wj-backup-"));
    const db = await dumpDatabase();
    await writeFile(join(stage, "db.json"), JSON.stringify(db));
    await writeFile(join(stage, "manifest.json"), JSON.stringify({
      version: 1,
      app: "werejugo",
      createdAt: new Date().toISOString(),
      tables: BACKUP_TABLES,
      counts: Object.fromEntries(BACKUP_TABLES.map((t) => [t, db[t].length])),
    }));
    // include the storage tree as storage/ (copy so we can tar from one cwd)
    await mkdir(join(stage, "storage"), { recursive: true });
    await cp(config.storageDir, join(stage, "storage"), { recursive: true });

    const archive = join(stage, "werejugo-backup.tar.gz");
    await tar.c({ gzip: true, file: archive, cwd: stage }, ["db.json", "manifest.json", "storage"]);

    reply.header("Content-Type", "application/gzip");
    reply.header("Content-Disposition", `attachment; filename="werejugo-backup.tar.gz"`);
    const stream = createReadStream(archive);
    stream.on("close", () => { void rm(stage, { recursive: true, force: true }); });
    return reply.send(stream);
  });
}
```

- [ ] **Step 6: Register the route**

In `backend/src/index.ts`, add the import:

```ts
import { backupRoutes } from "./routes/backup.js";
```

and register it after `exportRoutes`:

```ts
  await app.register(backupRoutes);
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- backup`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/src/lib/archive.ts backend/src/routes/backup.ts backend/src/routes/backup.test.ts backend/src/index.ts backend/package.json backend/package-lock.json
git commit -m "feat(backup): GET /api/backup tar.gz (db.json + storage tree)"
```

---

### Task 6: Restore `POST /api/restore`

**Files:**
- Modify: `backend/src/routes/backup.ts` (add the restore route + raised file limit)
- Test: `backend/src/routes/restore.test.ts`

- [ ] **Step 1: Write the failing test (a full round-trip)**

Create `backend/src/routes/restore.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import FormData from "form-data";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { config } from "../config.js";
import { writeFile, mkdir } from "node:fs/promises";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await buildTestApp();
  await query("INSERT INTO trips (family_id, name, created_by) VALUES ($1,'Round Trip',$2)", [ctx.familyId, ctx.userId]);
  await mkdir(join(config.storageDir, "loose", "2024"), { recursive: true });
  await writeFile(join(config.storageDir, "loose", "2024", "keep.txt"), "original");
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("backup → wipe → restore brings rows and files back", async () => {
  // 1. take a backup
  const bk = await ctx.app.inject({ method: "GET", url: "/api/backup", headers: auth() });
  const archive = bk.rawPayload;

  // 2. destroy the world
  await query("DELETE FROM trips");
  await writeFile(join(config.storageDir, "loose", "2024", "keep.txt"), "CLOBBERED");
  expect((await query("SELECT 1 FROM trips")).rowCount).toBe(0);

  // 3. restore
  const form = new FormData();
  form.append("file", archive, { filename: "backup.tar.gz", contentType: "application/gzip" });
  const res = await ctx.app.inject({ method: "POST", url: "/api/restore", headers: { ...auth(), ...form.getHeaders() }, payload: form.getBuffer() });
  expect(res.statusCode).toBe(200);
  expect(res.json().counts.trips).toBe(1);

  // 4. data + files are back
  const names = (await query<{ name: string }>("SELECT name FROM trips")).rows.map((r) => r.name);
  expect(names).toEqual(["Round Trip"]);
  expect(await readFile(join(config.storageDir, "loose", "2024", "keep.txt"), "utf8")).toBe("original");
});

test("a non-owner cannot restore", async () => {
  const memberToken = ctx.app.jwt.sign({ id: ctx.userId, familyId: ctx.familyId, role: "member" });
  const form = new FormData();
  form.append("file", Buffer.from("x"), { filename: "b.tar.gz", contentType: "application/gzip" });
  const res = await ctx.app.inject({ method: "POST", url: "/api/restore",
    headers: { authorization: `Bearer ${memberToken}`, ...form.getHeaders() }, payload: form.getBuffer() });
  expect(res.statusCode).toBe(403);
});

test("a malformed archive is rejected", async () => {
  const form = new FormData();
  form.append("file", Buffer.from("not a tar"), { filename: "b.tar.gz", contentType: "application/gzip" });
  const res = await ctx.app.inject({ method: "POST", url: "/api/restore", headers: { ...auth(), ...form.getHeaders() }, payload: form.getBuffer() });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- restore`
Expected: FAIL — `/api/restore` not registered.

- [ ] **Step 3: Implement the restore route**

In `backend/src/routes/backup.ts`, extend the imports:

```ts
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile, cp, mkdir, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
```

(replace the existing `node:fs`/`node:fs/promises` import lines accordingly), and add these imports:

```ts
import { tx } from "../db/pool.js";
import { restoreDatabase } from "../lib/archive.js";
```

Then add the restore route inside `backupRoutes`, after the backup route:

```ts
  app.post("/api/restore", { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.role !== "owner") return reply.code(403).send({ error: "Only an owner can restore a backup" });

    const data = await req.file({ limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: "No archive uploaded" });

    const work = await mkdtemp(join(tmpdir(), "wj-restore-"));
    try {
      const tgz = join(work, "upload.tar.gz");
      await pipeline(data.file, createWriteStream(tgz));
      try {
        await tar.x({ file: tgz, cwd: work });
      } catch {
        return reply.code(400).send({ error: "Archive is not a valid .tar.gz" });
      }

      let manifest: any;
      let db: Record<string, unknown[]>;
      try {
        manifest = JSON.parse(await readFile(join(work, "manifest.json"), "utf8"));
        db = JSON.parse(await readFile(join(work, "db.json"), "utf8"));
      } catch {
        return reply.code(400).send({ error: "Archive is missing db.json or manifest.json" });
      }
      if (manifest?.app !== "werejugo" || !Array.isArray(manifest.tables)) {
        return reply.code(400).send({ error: "Unrecognized backup archive" });
      }

      const counts = await tx((client) => restoreDatabase(client, db));

      // replace the storage tree
      await rm(config.storageDir, { recursive: true, force: true });
      await mkdir(config.storageDir, { recursive: true });
      await cp(join(work, "storage"), config.storageDir, { recursive: true });

      return { ok: true, counts };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
```

> Note: `req.file()` comes from `@fastify/multipart`, already registered in `index.ts`. The per-call `limits.fileSize` overrides the global 25 MB cap for this route only.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- restore`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full backend gate**

Run: `npm test` then `npm run typecheck`
Expected: all suites PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/backup.ts backend/src/routes/restore.test.ts
git commit -m "feat(backup): POST /api/restore (owner-only wipe-and-replace)"
```

---

## Self-review notes (for the executor)

- **`req.file` typing:** `@fastify/multipart` augments `FastifyRequest` with `file()` globally (it is used in `media.ts`/`documents.ts`). No extra import needed.
- **`tx` helper** is in `db/pool.ts` and commits/rolls back automatically — `restoreDatabase` must not call BEGIN/COMMIT itself.
- **Order between tasks:** Task 3 leaves a 404 stub for the public route so the file compiles; Task 4 replaces it. Do not skip Task 4.
- If `npm install tar@^7` fails (offline), STOP and report — do not hand-roll a tar writer.
