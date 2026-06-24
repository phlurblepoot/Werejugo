# Phase 6A — Trip Planning Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the planning backend: a trip `status`, an `itinerary_items` model (scheduled vs wishlist) with convert-to-visit, and `blackout_periods` CRUD.

**Architecture:** A migration adds `trips.status` + two tables. `trips.ts` gains `status`. New `itinerary.ts` and `blackouts.ts` route files. Bookings and travelers reuse the existing `documents` and `relations` endpoints (no new routes). Family-scoped, `zod`-validated.

**Tech Stack:** Fastify 5 (ESM, `.js` suffixes), PostgreSQL/PostGIS via `pg`, `zod`. Tests: Vitest against the Phase-1 test DB harness.

**Scope note:** Plan **6A** of Phase 6. Plan **6B** (PlanningPage + board/timeline/detail/blackouts) consumes these endpoints.

---

## Conventions (apply to every task)

- Backend commands run from `backend/`. ESM imports use `.js` suffixes.
- Routes: `requireAuth` preHandler, `zod` `safeParse` → 400, `req.user.familyId` scoping, snake→camel DTOs, 404 on cross-family.
- New route files registered in `index.ts` in the task that creates them. Commit after each task with its final-step message.

---

## File Structure

**New files:**
- `backend/src/db/migrations/0009_trip_planning.sql`
- `backend/src/routes/itinerary.ts` — itinerary CRUD + convert.
- `backend/src/routes/blackouts.ts` — blackout CRUD.

**Modified files:**
- `backend/src/routes/trips.ts` — add `status`.
- `backend/src/index.ts` — register `itineraryRoutes`, `blackoutRoutes`.

---

## Task 1: Migration

**Files:**
- Create: `backend/src/db/migrations/0009_trip_planning.sql`

- [ ] **Step 1: Write the migration**

Create `backend/src/db/migrations/0009_trip_planning.sql`:
```sql
-- Trip planning: status lifecycle, blackout periods, and itinerary items.
ALTER TABLE trips ADD COLUMN status TEXT NOT NULL DEFAULT 'idea'
  CHECK (status IN ('idea', 'planning', 'booked', 'done'));

CREATE TABLE blackout_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  color       TEXT NOT NULL DEFAULT '#64748b',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_blackouts_family ON blackout_periods(family_id);

CREATE TABLE itinerary_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id          UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  trip_id            UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  notes              TEXT NOT NULL DEFAULT '',
  scheduled_on       DATE,                    -- NULL = wishlist
  seq                INTEGER NOT NULL DEFAULT 0,
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  place_label        TEXT NOT NULL DEFAULT '',
  converted_visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_itinerary_trip ON itinerary_items(trip_id);
```

- [ ] **Step 2: Apply it**

Run: `cd backend && npm run migrate`
Expected: `[migrate] applying 0009_trip_planning.sql` then `[migrate] up to date`.

- [ ] **Step 3: Confirm via the harness**

Run: `cd backend && npm test -- src/test/harness.test.ts`
Expected: PASS (the test DB runs all migrations).

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/0009_trip_planning.sql
git commit -m "feat(db): trip status + blackout_periods + itinerary_items"
```

---

## Task 2: Trip status

**Files:**
- Modify: `backend/src/routes/trips.ts`
- Test: `backend/src/routes/trips-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/trips-status.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("a trip defaults to 'idea' and can be moved to another status", async () => {
  const create = await ctx.app.inject({ method: "POST", url: "/api/trips", headers: auth(), payload: { name: "Japan someday" } });
  expect(create.json().status).toBe("idea");
  const id = create.json().id;
  const patch = await ctx.app.inject({ method: "PATCH", url: `/api/trips/${id}`, headers: auth(), payload: { status: "planning" } });
  expect(patch.json().status).toBe("planning");
});

test("rejects an invalid status", async () => {
  const res = await ctx.app.inject({ method: "POST", url: "/api/trips", headers: auth(), payload: { name: "X", status: "nope" } });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/trips-status.test.ts`
Expected: FAIL (no `status` on the DTO).

- [ ] **Step 3: Add `status` to `trips.ts`**

In `backend/src/routes/trips.ts`:
- Add to `upsertSchema`: `status: z.enum(["idea", "planning", "booked", "done"]).optional(),`
- Add to `interface TripRow`: `status: string;`
- Add to `toDto`: `status: r.status,`
- In the `POST` INSERT, add the `status` column and value (before `created_by`):
```ts
    const { rows } = await query<TripRow>(
      `INSERT INTO trips (family_id, name, description, start_date, end_date, cover_photo_url, color, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.familyId, b.name, b.description ?? "", b.startDate || null, b.endDate || null,
       b.coverPhotoUrl ?? null, b.color ?? "#2563eb", b.status ?? "idea", req.user.id]);
```
- In the `PATCH` UPDATE, add `status = COALESCE($12, status)` to the SET list and the param `b.status ?? null` at the end:
```ts
    const { rows } = await query<TripRow>(
      `UPDATE trips SET
         name = COALESCE($3, name), description = COALESCE($4, description),
         start_date = CASE WHEN $5::boolean THEN $6 ELSE start_date END,
         end_date = CASE WHEN $7::boolean THEN $8 ELSE end_date END,
         cover_photo_url = CASE WHEN $9::boolean THEN $10 ELSE cover_photo_url END,
         color = COALESCE($11, color),
         status = COALESCE($12, status)
       WHERE id = $1 AND family_id = $2 RETURNING *`,
      [id, req.user.familyId, b.name ?? null, b.description ?? null,
       has("startDate"), b.startDate || null, has("endDate"), b.endDate || null,
       has("coverPhotoUrl"), b.coverPhotoUrl ?? null, b.color ?? null, b.status ?? null]);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/trips-status.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/trips.ts backend/src/routes/trips-status.test.ts
git commit -m "feat(trips): status (idea/planning/booked/done)"
```

---

## Task 3: Itinerary CRUD

**Files:**
- Create: `backend/src/routes/itinerary.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/routes/itinerary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/itinerary.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  tripId = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1,'Italy') RETURNING id", [ctx.familyId])).rows[0].id;
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates scheduled and wishlist items and lists them (scheduled first)", async () => {
  const wish = await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/itinerary`, headers: auth(), payload: { title: "Gelato crawl" } });
  expect(wish.json().scheduledOn).toBeNull();
  await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/itinerary`, headers: auth(), payload: { title: "Colosseum", scheduledOn: "2025-06-04" } });

  const list = await ctx.app.inject({ method: "GET", url: `/api/trips/${tripId}/itinerary`, headers: auth() });
  const items = list.json();
  expect(items).toHaveLength(2);
  expect(items[0].title).toBe("Colosseum"); // scheduled first
});

test("schedules a wishlist item via patch and deletes it", async () => {
  const created = await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/itinerary`, headers: auth(), payload: { title: "Tuscany" } });
  const id = created.json().id;
  const patch = await ctx.app.inject({ method: "PATCH", url: `/api/itinerary/${id}`, headers: auth(), payload: { scheduledOn: "2025-06-08" } });
  expect(patch.json().scheduledOn).toBe("2025-06-08");
  const del = await ctx.app.inject({ method: "DELETE", url: `/api/itinerary/${id}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/itinerary.test.ts`
Expected: FAIL (routes missing).

- [ ] **Step 3: Implement `itinerary.ts`**

Create `backend/src/routes/itinerary.ts`:
```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

interface ItinRow {
  id: string; trip_id: string; title: string; notes: string;
  scheduled_on: string | null; seq: number; lat: number | null; lng: number | null;
  place_label: string; converted_visit_id: string | null; created_at: string;
}
function toDto(r: ItinRow) {
  return {
    id: r.id, tripId: r.trip_id, title: r.title, notes: r.notes,
    scheduledOn: r.scheduled_on, seq: r.seq, lat: r.lat, lng: r.lng,
    placeLabel: r.place_label, convertedVisitId: r.converted_visit_id, createdAt: r.created_at,
  };
}
const SELECT = `SELECT id, trip_id, title, notes, to_char(scheduled_on,'YYYY-MM-DD') AS scheduled_on,
  seq, lat, lng, place_label, converted_visit_id, created_at FROM itinerary_items`;

const itemSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(4000).optional(),
  scheduledOn: z.string().nullish(),
  seq: z.coerce.number().int().optional(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
  placeLabel: z.string().max(200).optional(),
});

async function ownsTrip(familyId: string, tripId: string): Promise<boolean> {
  const { rowCount } = await query("SELECT 1 FROM trips WHERE id = $1 AND family_id = $2", [tripId, familyId]);
  return Boolean(rowCount);
}
async function loadItem(familyId: string, id: string): Promise<ItinRow | null> {
  const { rows } = await query<ItinRow>(`${SELECT} WHERE id = $1 AND family_id = $2`, [id, familyId]);
  return rows[0] ?? null;
}

export async function itineraryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/trips/:tripId/itinerary", async (req, reply) => {
    const tripId = (req.params as { tripId: string }).tripId;
    if (!(await ownsTrip(req.user.familyId, tripId))) return reply.code(404).send({ error: "Trip not found" });
    const { rows } = await query<ItinRow>(
      `${SELECT} WHERE trip_id = $1 ORDER BY scheduled_on ASC NULLS LAST, seq ASC, created_at ASC`, [tripId]);
    return rows.map(toDto);
  });

  app.post("/api/trips/:tripId/itinerary", async (req, reply) => {
    const tripId = (req.params as { tripId: string }).tripId;
    if (!(await ownsTrip(req.user.familyId, tripId))) return reply.code(404).send({ error: "Trip not found" });
    const parsed = itemSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const ins = await query<{ id: string }>(
      `INSERT INTO itinerary_items (family_id, trip_id, title, notes, scheduled_on, seq, lat, lng, place_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.user.familyId, tripId, b.title, b.notes ?? "", b.scheduledOn || null, b.seq ?? 0, b.lat ?? null, b.lng ?? null, b.placeLabel ?? ""]);
    return reply.code(201).send(toDto((await loadItem(req.user.familyId, ins.rows[0].id))!));
  });

  app.patch("/api/itinerary/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await loadItem(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const parsed = itemSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    await query(
      `UPDATE itinerary_items SET
         title = COALESCE($3, title), notes = COALESCE($4, notes),
         scheduled_on = CASE WHEN $5::boolean THEN $6 ELSE scheduled_on END,
         seq = COALESCE($7, seq),
         lat = CASE WHEN $8::boolean THEN $9 ELSE lat END,
         lng = CASE WHEN $10::boolean THEN $11 ELSE lng END,
         place_label = COALESCE($12, place_label)
       WHERE id = $1 AND family_id = $2`,
      [id, req.user.familyId, b.title ?? null, b.notes ?? null,
       has("scheduledOn"), b.scheduledOn || null, b.seq ?? null,
       has("lat"), b.lat ?? null, has("lng"), b.lng ?? null, b.placeLabel ?? null]);
    return toDto((await loadItem(req.user.familyId, id))!);
  });

  app.delete("/api/itinerary/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM itinerary_items WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });
}
```

> `loadItem`, `SELECT`, `itemSchema`, `toDto`, `ownsTrip` are reused by Task 4 (convert).

- [ ] **Step 4: Register the route**

In `backend/src/index.ts`, add `import { itineraryRoutes } from "./routes/itinerary.js";` and `await app.register(itineraryRoutes);`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/itinerary.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/itinerary.ts backend/src/routes/itinerary.test.ts backend/src/index.ts
git commit -m "feat(itinerary): CRUD (scheduled + wishlist items)"
```

---

## Task 4: Convert itinerary item to a visit

**Files:**
- Modify: `backend/src/routes/itinerary.ts`
- Test: `backend/src/routes/itinerary-convert.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/itinerary-convert.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  tripId = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1,'Italy') RETURNING id", [ctx.familyId])).rows[0].id;
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("converts an item to a visit and is idempotent", async () => {
  const item = await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/itinerary`, headers: auth(),
    payload: { title: "Colosseum", scheduledOn: "2025-06-04", lat: 41.8902, lng: 12.4924 } });
  const id = item.json().id;

  const conv = await ctx.app.inject({ method: "POST", url: `/api/itinerary/${id}/convert`, headers: auth() });
  expect(conv.statusCode).toBe(200);
  const visitId = conv.json().visitId;
  const v = await query<{ title: string; trip_id: string; occurred_on: string; geom: string | null }>(
    "SELECT title, trip_id, to_char(occurred_on,'YYYY-MM-DD') AS occurred_on, ST_AsText(geom) AS geom FROM visits WHERE id = $1", [visitId]);
  expect(v.rows[0]).toMatchObject({ title: "Colosseum", trip_id: tripId, occurred_on: "2025-06-04" });
  expect(v.rows[0].geom).toContain("POINT");

  // idempotent: second convert returns the same visit
  const again = await ctx.app.inject({ method: "POST", url: `/api/itinerary/${id}/convert`, headers: auth() });
  expect(again.json().visitId).toBe(visitId);
  const count = await query("SELECT 1 FROM visits WHERE trip_id = $1", [tripId]);
  expect(count.rowCount).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/itinerary-convert.test.ts`
Expected: FAIL (route missing).

- [ ] **Step 3: Add convert to `itinerary.ts`**

Extend the imports and add the handler. At the top, add `tx`:
```ts
import { query, tx } from "../db/pool.js";
```
Add inside `itineraryRoutes`:
```ts
  app.post("/api/itinerary/:id/convert", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const item = await loadItem(req.user.familyId, id);
    if (!item) return reply.code(404).send({ error: "Not found" });
    if (item.converted_visit_id) return { visitId: item.converted_visit_id, item: toDto(item) };

    const visitId = await tx(async (client) => {
      const res = await client.query<{ id: string }>(
        `INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, geom, created_by)
         VALUES ($1,$2,'place',$3,$4,
           CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5,$6),4326) END, $7)
         RETURNING id`,
        [req.user.familyId, item.trip_id, item.title, item.scheduled_on, item.lng, item.lat, req.user.id]);
      const vid = res.rows[0].id;
      await client.query("UPDATE itinerary_items SET converted_visit_id = $1 WHERE id = $2", [vid, id]);
      return vid;
    });
    const updated = await loadItem(req.user.familyId, id);
    return { visitId, item: toDto(updated!) };
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/itinerary-convert.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/itinerary.ts backend/src/routes/itinerary-convert.test.ts
git commit -m "feat(itinerary): convert an item to a real visit (idempotent)"
```

---

## Task 5: Blackout periods

**Files:**
- Create: `backend/src/routes/blackouts.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/routes/blackouts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/blackouts.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates, lists, updates, and deletes a blackout", async () => {
  const create = await ctx.app.inject({ method: "POST", url: "/api/blackouts", headers: auth(),
    payload: { label: "School 2025-26", startDate: "2025-09-01", endDate: "2026-06-15" } });
  expect(create.statusCode).toBe(201);
  const id = create.json().id;
  const list = await ctx.app.inject({ method: "GET", url: "/api/blackouts", headers: auth() });
  expect(list.json()).toHaveLength(1);
  const patch = await ctx.app.inject({ method: "PATCH", url: `/api/blackouts/${id}`, headers: auth(), payload: { label: "School year" } });
  expect(patch.json().label).toBe("School year");
  const del = await ctx.app.inject({ method: "DELETE", url: `/api/blackouts/${id}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});

test("rejects an end before the start", async () => {
  const res = await ctx.app.inject({ method: "POST", url: "/api/blackouts", headers: auth(),
    payload: { label: "Bad", startDate: "2025-06-10", endDate: "2025-06-01" } });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/blackouts.test.ts`
Expected: FAIL (routes missing).

- [ ] **Step 3: Implement `blackouts.ts`**

Create `backend/src/routes/blackouts.ts`:
```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

interface BlackoutRow { id: string; label: string; start_date: string; end_date: string; color: string; created_at: string; }
const toDto = (r: BlackoutRow) => ({ id: r.id, label: r.label, startDate: r.start_date, endDate: r.end_date, color: r.color, createdAt: r.created_at });
const SELECT = `SELECT id, label, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, color, created_at FROM blackout_periods`;

const schema = z.object({
  label: z.string().min(1).max(160),
  startDate: z.string(),
  endDate: z.string(),
  color: z.string().max(40).optional(),
}).refine((b) => b.endDate >= b.startDate, { message: "End date must be on or after the start date" });

export async function blackoutRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/blackouts", async (req) => {
    const { rows } = await query<BlackoutRow>(`${SELECT} WHERE family_id = $1 ORDER BY start_date ASC`, [req.user.familyId]);
    return rows.map(toDto);
  });

  app.post("/api/blackouts", async (req, reply) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const { rows } = await query<{ id: string }>(
      "INSERT INTO blackout_periods (family_id, label, start_date, end_date, color) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [req.user.familyId, b.label, b.startDate, b.endDate, b.color ?? "#64748b"]);
    const out = await query<BlackoutRow>(`${SELECT} WHERE id = $1`, [rows[0].id]);
    return reply.code(201).send(toDto(out.rows[0]));
  });

  app.patch("/api/blackouts/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = schema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const { rows } = await query<BlackoutRow>(
      `UPDATE blackout_periods SET label = COALESCE($3, label),
         start_date = COALESCE($4, start_date), end_date = COALESCE($5, end_date), color = COALESCE($6, color)
       WHERE id = $1 AND family_id = $2
       RETURNING id, label, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, color, created_at`,
      [id, req.user.familyId, b.label ?? null, b.startDate ?? null, b.endDate ?? null, b.color ?? null]);
    if (!rows[0]) return reply.code(404).send({ error: "Not found" });
    return toDto(rows[0]);
  });

  app.delete("/api/blackouts/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM blackout_periods WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });
}
```

> Note: `schema.partial()` drops the `.refine`, so a PATCH that sets only one date won't re-check ordering against the stored value. Acceptable for v1 (the form sends both dates together); a stricter cross-field check is a later refinement.

- [ ] **Step 4: Register the route**

In `backend/src/index.ts`, add `import { blackoutRoutes } from "./routes/blackouts.js";` and `await app.register(blackoutRoutes);`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/blackouts.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/blackouts.ts backend/src/routes/blackouts.test.ts backend/src/index.ts
git commit -m "feat(blackouts): blackout-period CRUD"
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
git commit -m "chore: phase 6A planning backend verified" || echo "nothing to commit"
```

---

## Notes for Plan 6B (frontend)

- `Trip` DTO now includes `status: "idea"|"planning"|"booked"|"done"`. `updateTrip(id, { status })` moves a board card.
- Itinerary: `GET /api/trips/:tripId/itinerary` → `ItineraryItem[]` (`{ id, tripId, title, notes, scheduledOn, seq, lat, lng, placeLabel, convertedVisitId, createdAt }`); `POST /api/trips/:tripId/itinerary`, `PATCH /api/itinerary/:id`, `DELETE /api/itinerary/:id`, `POST /api/itinerary/:id/convert` → `{ visitId, item }`.
- Blackouts: `GET/POST/PATCH/DELETE /api/blackouts` → `{ id, label, startDate, endDate, color, createdAt }`.
- Bookings: `GET /api/documents?owner=trip:<id>`. Travelers: `GET /api/relations?entity=trip:<id>` (filter `entity.type === "person"`).
