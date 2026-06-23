# Phase 4A — Photos/Media Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `media` core the endpoints the Photos library needs: EXIF captured on upload (`taken_at`/`geom`), a filterable+paginated `GET /api/media` list, and `POST /api/media/suggestions` + `POST /api/media/apply-suggestion` for the upload review flow.

**Architecture:** No schema changes — `media` already has `taken_at`, `geom`, `trip_id`, dimensions. A shared `lib/exif.ts` helper (factored from the existing `/api/exif` route) runs at upload time. The list endpoint is added to `media.ts`; suggestions/apply live in a new `media-suggest.ts`. All family-scoped, `zod`-validated, following the established route pattern.

**Tech Stack:** Fastify 5 (ESM, `.js` suffixes), PostgreSQL/PostGIS via `pg`, `zod`, `exifr`. Tests: Vitest against the Phase-1 test DB harness (`buildTestApp`/`resetDb`).

**Scope note:** Plan **4A** of Phase 4 — API-testable backend. Plan **4B** (PhotosPage + filters/grid/map/detail/upload-review) consumes these endpoints.

---

## Conventions (apply to every task)

- Backend commands run from `backend/`. ESM imports use `.js` suffixes.
- Routes follow the existing shape: `requireAuth` preHandler, `zod` `safeParse` → 400, `req.user.familyId` scoping, snake→camel DTOs, 404 on cross-family.
- Each new route file is registered in `backend/src/index.ts` in the task that creates it.
- The Phase-1 test DB + vitest config are already set up. Commit after each task with the message in its final step.

---

## File Structure

**New files:**
- `backend/src/lib/exif.ts` — `extractExif(input)` (GPS + capture date), shared by upload and `/api/exif`.
- `backend/src/routes/media-suggest.ts` — `POST /api/media/suggestions` and `POST /api/media/apply-suggestion`.

**Modified files:**
- `backend/src/routes/media.ts` — capture EXIF on upload; add the `GET /api/media` list endpoint; expose a richer list DTO.
- `backend/src/routes/exif.ts` — use the shared helper.
- `backend/src/index.ts` — register `mediaSuggestRoutes`.

---

## Task 1: `extractExif` helper

**Files:**
- Create: `backend/src/lib/exif.ts`
- Modify: `backend/src/routes/exif.ts`
- Test: `backend/src/lib/exif.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/exif.test.ts`:
```ts
import { expect, test } from "vitest";
import sharp from "sharp";
import { extractExif } from "./exif.js";

test("returns nulls for an image with no EXIF", async () => {
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
  const r = await extractExif(png);
  expect(r).toEqual({ takenAt: null, lat: null, lng: null });
});

test("does not throw on non-image bytes", async () => {
  const r = await extractExif(Buffer.from("not an image"));
  expect(r).toEqual({ takenAt: null, lat: null, lng: null });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/lib/exif.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the helper**

Create `backend/src/lib/exif.ts`:
```ts
import exifr from "exifr";

export interface ExifData {
  takenAt: string | null; // ISO datetime
  lat: number | null;
  lng: number | null;
}

/** Best-effort EXIF: GPS coordinates and capture date. Accepts a file path or buffer. */
export async function extractExif(input: string | Buffer): Promise<ExifData> {
  let lat: number | null = null;
  let lng: number | null = null;
  let takenAt: string | null = null;
  try {
    const gps = await exifr.gps(input as never);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      lat = gps.latitude;
      lng = gps.longitude;
    }
  } catch {
    /* no GPS */
  }
  try {
    const meta = await exifr.parse(input as never, ["DateTimeOriginal", "CreateDate"]);
    const d = meta?.DateTimeOriginal ?? meta?.CreateDate;
    if (d) takenAt = new Date(d).toISOString();
  } catch {
    /* no date */
  }
  return { takenAt, lat, lng };
}
```

- [ ] **Step 4: Refactor `exif.ts` to use it**

Replace the body of `backend/src/routes/exif.ts` with:
```ts
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { extractExif } from "../lib/exif.js";

/** Extract GPS coordinates and capture date from an uploaded photo's EXIF data. */
export async function exifRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/exif", async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: "No file provided" });
    const { takenAt, lat, lng } = await extractExif(await part.toBuffer());
    // The map editor expects a date-only string.
    return { lat, lng, date: takenAt ? takenAt.slice(0, 10) : null };
  });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npm test -- src/lib/exif.test.ts && npm run typecheck`
Expected: tests PASS (2); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/exif.ts backend/src/lib/exif.test.ts backend/src/routes/exif.ts
git commit -m "feat(exif): shared extractExif helper; exif route uses it"
```

---

## Task 2: Capture EXIF on upload

**Files:**
- Modify: `backend/src/routes/media.ts`
- Test: `backend/src/routes/media.test.ts` (extend the existing file)

- [ ] **Step 1: Write the failing test**

Append to `backend/src/routes/media.test.ts`:
```ts
test("upload stores null taken_at/geom for a photo with no EXIF", async () => {
  const id = await uploadPng("no-exif.png");
  const row = await query<{ taken_at: string | null; geom: string | null }>(
    "SELECT taken_at, ST_AsText(geom) AS geom FROM media WHERE id = $1", [id]);
  expect(row.rows[0].taken_at).toBeNull();
  expect(row.rows[0].geom).toBeNull();
});
```
(The file already has `uploadPng`, `ctx`, `query`, and `auth` from Phase 1.)

- [ ] **Step 2: Run to verify it fails... or passes trivially**

Run: `cd backend && npm test -- src/routes/media.test.ts`
Expected: This particular assertion already holds (EXIF is never read yet), so it PASSES — that's fine; it's a guard. Continue to wire EXIF so real photos get populated.

- [ ] **Step 3: Capture EXIF in the upload handler**

In `backend/src/routes/media.ts`:
- Add to the storage import: `import { mediaDirFor, saveMediaUpload, deleteStored, absStoragePath } from "../lib/storage.js";`
- Add: `import { extractExif } from "../lib/exif.js";`
- Replace the INSERT block in `POST /api/media` (after `if (!saved) ...`) with:
```ts
    const exif = await extractExif(absStoragePath(saved.relPath));
    const { rows } = await query<MediaRow>(
      `INSERT INTO media (family_id, kind, rel_path, thumb_rel_path, original_name, caption, width, height, taken_at, geom, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         CASE WHEN $10::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($10,$11),4326) END,
         $12)
       RETURNING *`,
      [req.user.familyId, saved.kind, saved.relPath, saved.thumbRelPath, originalName, caption,
       saved.width, saved.height, exif.takenAt, exif.lng, exif.lat, req.user.id],
    );
    return reply.code(201).send(toDto(rows[0]));
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/media.test.ts`
Expected: PASS (all media tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/media.ts backend/src/routes/media.test.ts
git commit -m "feat(media): capture EXIF date + GPS on upload"
```

---

## Task 3: `GET /api/media` — filtered, paginated list

**Files:**
- Modify: `backend/src/routes/media.ts`
- Test: `backend/src/routes/media-list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/media-list.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string, personId: string, visitId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  const t = await query<{ id: string }>("INSERT INTO trips (family_id, name, start_date, end_date) VALUES ($1,'Italy','2024-06-01','2024-06-30') RETURNING id", [ctx.familyId]);
  tripId = t.rows[0].id;
  const p = await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1,'Mom') RETURNING id", [ctx.familyId]);
  personId = p.rows[0].id;
  const v = await query<{ id: string }>("INSERT INTO visits (family_id, kind, title, geom) VALUES ($1,'place','Colosseum', ST_SetSRID(ST_MakePoint(12.4924,41.8902),4326)) RETURNING id", [ctx.familyId]);
  visitId = v.rows[0].id;
  // m1: in trip, taken June, near colosseum, linked to Mom
  const m1 = await query<{ id: string }>(
    `INSERT INTO media (family_id, kind, rel_path, taken_at, geom, trip_id) VALUES
     ($1,'image','loose/2024/a.jpg','2024-06-10T10:00:00Z', ST_SetSRID(ST_MakePoint(12.4925,41.8903),4326), $2) RETURNING id`, [ctx.familyId, tripId]);
  await query("INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role) VALUES ($1,'media',$2,'person',$3,'shows')", [ctx.familyId, m1.rows[0].id, personId]);
  // m2: no trip, taken March, no geom
  await query("INSERT INTO media (family_id, kind, rel_path, taken_at) VALUES ($1,'image','loose/2024/b.jpg','2024-03-05T10:00:00Z')", [ctx.familyId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("lists all family media newest-first with cursors", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/media", headers: auth() });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.items).toHaveLength(2);
  expect(body.items[0].takenAt).toContain("2024-06-10"); // newest first
  expect(body.items[0].url).toContain("/api/files/");
  expect(body.items[0].cursor).toBeTruthy();
});

test("filters by trip, person, date range, and bbox", async () => {
  const byTrip = await ctx.app.inject({ method: "GET", url: `/api/media?trip=${tripId}`, headers: auth() });
  expect(byTrip.json().items).toHaveLength(1);
  const byPerson = await ctx.app.inject({ method: "GET", url: `/api/media?person=${personId}`, headers: auth() });
  expect(byPerson.json().items).toHaveLength(1);
  const byVisit = await ctx.app.inject({ method: "GET", url: `/api/media?visit=${visitId}`, headers: auth() });
  expect(byVisit.json().items).toHaveLength(0); // not linked to the visit
  const byDate = await ctx.app.inject({ method: "GET", url: "/api/media?from=2024-06-01&to=2024-06-30", headers: auth() });
  expect(byDate.json().items).toHaveLength(1);
  const byBbox = await ctx.app.inject({ method: "GET", url: "/api/media?bbox=12,41,13,42", headers: auth() });
  expect(byBbox.json().items).toHaveLength(1); // only m1 has geom
});

test("paginates with limit + before cursor", async () => {
  const page1 = await ctx.app.inject({ method: "GET", url: "/api/media?limit=1", headers: auth() });
  expect(page1.json().items).toHaveLength(1);
  expect(page1.json().nextCursor).toBeTruthy();
  const page2 = await ctx.app.inject({ method: "GET", url: `/api/media?limit=1&before=${encodeURIComponent(page1.json().nextCursor)}`, headers: auth() });
  expect(page2.json().items).toHaveLength(1);
  expect(page2.json().items[0].id).not.toBe(page1.json().items[0].id);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/media-list.test.ts`
Expected: FAIL (route returns 404 / no list handler).

- [ ] **Step 3: Implement the list endpoint**

In `backend/src/routes/media.ts`, add a list DTO + the handler. After the existing `toDto`, add:
```ts
interface MediaListRow extends MediaRow {
  lng: number | null; lat: number | null; sort_ts: string;
}
function toListDto(r: MediaListRow) {
  return {
    id: r.id, kind: r.kind, tripId: r.trip_id,
    url: signFileUrl(r.rel_path),
    thumbUrl: r.thumb_rel_path ? signFileUrl(r.thumb_rel_path) : null,
    caption: r.caption, takenAt: r.taken_at, createdAt: r.created_at,
    width: r.width, height: r.height, lng: r.lng, lat: r.lat,
    cursor: `${r.sort_ts}__${r.id}`,
  };
}
```
Add inside `mediaRoutes`, before `app.get("/api/media/:id", ...)` (so the static route is registered before the param route):
```ts
  app.get("/api/media", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = ["m.family_id = $1"];
    const params: unknown[] = [req.user.familyId];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

    if (q.trip) where.push(`m.trip_id = ${add(q.trip)}`);
    if (q.person) {
      const ph = add(q.person); // capture the "$N" placeholder once; use it in both directions
      where.push(`EXISTS (SELECT 1 FROM links l WHERE l.family_id = m.family_id
        AND ((l.from_type='media' AND l.from_id=m.id AND l.to_type='person' AND l.to_id=${ph})
          OR (l.to_type='media' AND l.to_id=m.id AND l.from_type='person' AND l.from_id=${ph})))`);
    }
    if (q.visit) {
      const ph = add(q.visit);
      where.push(`EXISTS (SELECT 1 FROM links l WHERE l.family_id = m.family_id
        AND ((l.from_type='media' AND l.from_id=m.id AND l.to_type='visit' AND l.to_id=${ph})
          OR (l.to_type='media' AND l.to_id=m.id AND l.from_type='visit' AND l.from_id=${ph})))`);
    }
    if (q.from) where.push(`COALESCE(m.taken_at, m.created_at)::date >= ${add(q.from)}::date`);
    if (q.to) where.push(`COALESCE(m.taken_at, m.created_at)::date <= ${add(q.to)}::date`);
    if (q.bbox) {
      const b = q.bbox.split(",").map(Number);
      if (b.length === 4 && b.every(Number.isFinite)) {
        where.push(`m.geom && ST_MakeEnvelope(${add(b[0])},${add(b[1])},${add(b[2])},${add(b[3])},4326)`);
      }
    }
    if (q.before) {
      const sep = q.before.lastIndexOf("__");
      const ts = q.before.slice(0, sep);
      const id = q.before.slice(sep + 2);
      where.push(`(COALESCE(m.taken_at, m.created_at), m.id) < (${add(ts)}::timestamptz, ${add(id)}::uuid)`);
    }
    const limit = Math.min(Math.max(Number(q.limit) || 60, 1), 200);

    const { rows } = await query<MediaListRow>(
      `SELECT m.*, ST_X(m.geom) AS lng, ST_Y(m.geom) AS lat,
              COALESCE(m.taken_at, m.created_at) AS sort_ts
       FROM media m
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(m.taken_at, m.created_at) DESC, m.id DESC
       LIMIT ${limit}`,
      params,
    );
    const items = rows.map(toListDto);
    return { items, nextCursor: items.length === limit ? items[items.length - 1].cursor : null };
  });
```

> Note: `MediaRow` must include `created_at` and `width`/`height` (it does). `sort_ts` is selected explicitly so the cursor matches the ORDER BY key exactly.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/media-list.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/media.ts backend/src/routes/media-list.test.ts
git commit -m "feat(media): GET /api/media list with filters + keyset pagination"
```

---

## Task 4: Suggestions endpoint

**Files:**
- Create: `backend/src/routes/media-suggest.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/routes/media-suggest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/media-suggest.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string, visitId: string, m1: string, m2: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  tripId = (await query<{ id: string }>("INSERT INTO trips (family_id, name, start_date, end_date) VALUES ($1,'Italy','2024-06-01','2024-06-30') RETURNING id", [ctx.familyId])).rows[0].id;
  visitId = (await query<{ id: string }>("INSERT INTO visits (family_id, kind, title, geom) VALUES ($1,'place','Colosseum', ST_SetSRID(ST_MakePoint(12.4924,41.8902),4326)) RETURNING id", [ctx.familyId])).rows[0].id;
  m1 = (await query<{ id: string }>("INSERT INTO media (family_id, kind, rel_path, taken_at, geom) VALUES ($1,'image','loose/2024/a.jpg','2024-06-10T10:00:00Z', ST_SetSRID(ST_MakePoint(12.4925,41.8903),4326)) RETURNING id", [ctx.familyId])).rows[0].id;
  m2 = (await query<{ id: string }>("INSERT INTO media (family_id, kind, rel_path, taken_at) VALUES ($1,'image','loose/2024/b.jpg','2023-01-01T10:00:00Z') RETURNING id", [ctx.familyId])).rows[0].id;
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("suggests a trip by date and a visit by proximity", async () => {
  const res = await ctx.app.inject({ method: "POST", url: "/api/media/suggestions", headers: auth(), payload: { mediaIds: [m1, m2] } });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const trip = body.trips.find((t: any) => t.tripId === tripId);
  expect(trip.mediaIds).toEqual([m1]); // only m1's date is in range
  const visit = body.visits.find((v: any) => v.visitId === visitId);
  expect(visit.mediaIds).toEqual([m1]); // only m1 is near the colosseum
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/media-suggest.test.ts`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement `media-suggest.ts` (suggestions)**

Create `backend/src/routes/media-suggest.ts`:
```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

const idsSchema = z.object({ mediaIds: z.array(z.string().uuid()).min(1).max(500) });

export async function mediaSuggestRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/media/suggestions", async (req, reply) => {
    const parsed = idsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const ids = parsed.data.mediaIds;
    const fam = req.user.familyId;

    const tripRows = await query<{ trip_id: string; name: string; media_id: string }>(
      `SELECT t.id AS trip_id, t.name, m.id AS media_id
       FROM media m JOIN trips t ON t.family_id = m.family_id
       WHERE m.id = ANY($1::uuid[]) AND m.family_id = $2 AND m.taken_at IS NOT NULL
         AND t.start_date IS NOT NULL
         AND m.taken_at::date >= t.start_date
         AND (t.end_date IS NULL OR m.taken_at::date <= t.end_date)
       ORDER BY t.start_date ASC`,
      [ids, fam]);
    const visitRows = await query<{ visit_id: string; title: string; media_id: string }>(
      `SELECT v.id AS visit_id, v.title, m.id AS media_id
       FROM media m JOIN visits v ON v.family_id = m.family_id
       WHERE m.id = ANY($1::uuid[]) AND m.family_id = $2 AND m.geom IS NOT NULL
         AND v.geom IS NOT NULL AND GeometryType(v.geom) = 'POINT'
         AND ST_DWithin(m.geom::geography, v.geom::geography, 500)`,
      [ids, fam]);

    return { trips: group(tripRows.rows, "trip_id", "name"), visits: group(visitRows.rows, "visit_id", "title") };
  });
}

function group<T extends Record<string, string>>(rows: T[], idKey: keyof T, labelKey: keyof T) {
  const map = new Map<string, { id: string; label: string; mediaIds: string[] }>();
  for (const r of rows) {
    const id = r[idKey] as string;
    const g = map.get(id) ?? { id, label: r[labelKey] as string, mediaIds: [] };
    g.mediaIds.push(r.media_id);
    map.set(id, g);
  }
  return [...map.values()].map((g) =>
    idKey === "trip_id"
      ? { tripId: g.id, name: g.label, mediaIds: g.mediaIds }
      : { visitId: g.id, title: g.label, mediaIds: g.mediaIds },
  );
}
```

- [ ] **Step 4: Register the route**

In `backend/src/index.ts`, add `import { mediaSuggestRoutes } from "./routes/media-suggest.js";` and `await app.register(mediaSuggestRoutes);`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/media-suggest.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/media-suggest.ts backend/src/routes/media-suggest.test.ts backend/src/index.ts
git commit -m "feat(media): POST /api/media/suggestions (trip-by-date, visit-by-GPS)"
```

---

## Task 5: Apply-suggestion endpoint

**Files:**
- Modify: `backend/src/routes/media-suggest.ts`
- Test: `backend/src/routes/media-apply.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/media-apply.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("applies a trip (sets trip_id) and a visit (links) to media", async () => {
  const trip = await query<{ id: string }>("INSERT INTO trips (family_id, name, start_date) VALUES ($1,'Italy','2024-06-01') RETURNING id", [ctx.familyId]);
  const visit = await query<{ id: string }>("INSERT INTO visits (family_id, kind, title) VALUES ($1,'place','Colosseum') RETURNING id", [ctx.familyId]);
  const m = await query<{ id: string }>("INSERT INTO media (family_id, kind, rel_path) VALUES ($1,'image','loose/2024/a.jpg') RETURNING id", [ctx.familyId]);

  const resTrip = await ctx.app.inject({ method: "POST", url: "/api/media/apply-suggestion", headers: auth(),
    payload: { mediaIds: [m.rows[0].id], tripId: trip.rows[0].id } });
  expect(resTrip.statusCode).toBe(200);
  const row = await query<{ trip_id: string }>("SELECT trip_id FROM media WHERE id = $1", [m.rows[0].id]);
  expect(row.rows[0].trip_id).toBe(trip.rows[0].id);

  const resVisit = await ctx.app.inject({ method: "POST", url: "/api/media/apply-suggestion", headers: auth(),
    payload: { mediaIds: [m.rows[0].id], visitId: visit.rows[0].id } });
  expect(resVisit.statusCode).toBe(200);
  const link = await query("SELECT 1 FROM links WHERE family_id=$1 AND from_type='media' AND from_id=$2 AND to_type='visit' AND to_id=$3", [ctx.familyId, m.rows[0].id, visit.rows[0].id]);
  expect(link.rowCount).toBe(1);
});

test("rejects media from another family", async () => {
  const res = await ctx.app.inject({ method: "POST", url: "/api/media/apply-suggestion", headers: auth(),
    payload: { mediaIds: ["11111111-1111-1111-1111-111111111111"], tripId: null } });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/media-apply.test.ts`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement apply-suggestion**

In `backend/src/routes/media-suggest.ts`, add the import for the reconciler and `tx`, and a new handler inside `mediaSuggestRoutes`:
```ts
// at top, extend imports:
import { query, tx } from "../db/pool.js";
import { reconcileMediaTrip } from "../lib/reconcile.js";
```
```ts
  const applySchema = z.object({
    mediaIds: z.array(z.string().uuid()).min(1).max(500),
    tripId: z.string().uuid().nullable().optional(),
    visitId: z.string().uuid().optional(),
  });

  app.post("/api/media/apply-suggestion", async (req, reply) => {
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { mediaIds, tripId, visitId } = parsed.data;
    const fam = req.user.familyId;

    // Every media id must be this family's.
    const owned = await query<{ n: string }>(
      "SELECT COUNT(*)::int AS n FROM media WHERE id = ANY($1::uuid[]) AND family_id = $2", [mediaIds, fam]);
    if (Number(owned.rows[0].n) !== mediaIds.length) return reply.code(404).send({ error: "Some media not found" });
    if (tripId) {
      const t = await query("SELECT 1 FROM trips WHERE id = $1 AND family_id = $2", [tripId, fam]);
      if (!t.rowCount) return reply.code(404).send({ error: "Trip not found" });
    }
    if (visitId) {
      const v = await query("SELECT 1 FROM visits WHERE id = $1 AND family_id = $2", [visitId, fam]);
      if (!v.rowCount) return reply.code(404).send({ error: "Visit not found" });
    }

    await tx(async (client) => {
      if (tripId !== undefined) {
        for (const id of mediaIds) {
          await client.query("UPDATE media SET trip_id = $1 WHERE id = $2", [tripId, id]);
          await reconcileMediaTrip(client, id);
        }
      }
      if (visitId) {
        for (const id of mediaIds) {
          await client.query(
            `INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role, created_by)
             VALUES ($1,'media',$2,'visit',$3,'appears_in',$4)
             ON CONFLICT (family_id, from_type, from_id, to_type, to_id, role) DO NOTHING`,
            [fam, id, visitId, req.user.id]);
        }
      }
    });
    return { applied: mediaIds.length };
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/media-apply.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/media-suggest.ts backend/src/routes/media-apply.test.ts
git commit -m "feat(media): POST /api/media/apply-suggestion (bulk set trip / link visit)"
```

---

## Task 6: Full backend verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck**

Run: `cd backend && npm test && npm run typecheck`
Expected: all test files PASS; typecheck clean.

- [ ] **Step 2: Commit (if any incidental fixes)**

```bash
git add -A backend
git commit -m "chore: phase 4A photos backend verified" || echo "nothing to commit"
```

---

## Notes for Plan 4B (frontend)

- `GET /api/media?…` → `{ items: MediaItem[], nextCursor: string | null }`, `MediaItem = { id, kind, tripId, url, thumbUrl, caption, takenAt, createdAt, width, height, lng, lat, cursor }`. Filters: `person`, `trip`, `visit`, `from`, `to`, `bbox` (`minLng,minLat,maxLng,maxLat`), `limit`, `before` (= a prior item's `cursor`).
- `POST /api/media/suggestions` `{ mediaIds }` → `{ trips: [{tripId, name, mediaIds}], visits: [{visitId, title, mediaIds}] }`.
- `POST /api/media/apply-suggestion` `{ mediaIds, tripId?, visitId? }` → `{ applied }`.
- Existing: `PATCH /api/media/:id` (caption, tripId), `DELETE /api/media/:id`, `POST /api/media` (upload, now EXIF-aware), `POST /api/links` (people/visit links).
