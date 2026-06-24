# Phase 7A — Packing Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the packing backend: `packing_lists`/`packing_items` tables, built-in starter templates, and the routes for templates, list items (with check-off), per-trip lists (with seeding), and save-as-template — built-ins read-only.

**Architecture:** A migration adds the two tables. `seed.ts` gains idempotent built-in templates (family-less, like built-in themes). A `packing.ts` route file: a list is a **template** when `trip_id` is null, a **trip list** otherwise; built-in lists (`is_builtin`) are visible but read-only. Family-scoped, `zod`-validated.

**Tech Stack:** Fastify 5 (ESM, `.js` suffixes), PostgreSQL via `pg`, `zod`. Tests: Vitest against the Phase-1 test DB harness.

**Scope note:** Plan **7A** of Phase 7. Plan **7B** (PackingPage + checklist + trip section) consumes these endpoints.

---

## Conventions (apply to every task)

- Backend commands run from `backend/`. ESM imports use `.js` suffixes.
- Routes: `requireAuth` preHandler, `zod` `safeParse` → 400, `req.user.familyId` scoping, snake→camel DTOs, 404 on cross-family, 403 on built-in mutation.
- New route file registered in `index.ts` in the task that creates it. Commit after each task with its final-step message.

---

## File Structure

**New files:**
- `backend/src/db/migrations/0010_packing.sql`
- `backend/src/routes/packing.ts`

**Modified files:**
- `backend/src/db/seed.ts` — built-in templates.
- `backend/src/test/helpers.ts` — add `packing_lists` to the reset list.
- `backend/src/index.ts` — register `packingRoutes`.

---

## Task 1: Migration + test-reset

**Files:**
- Create: `backend/src/db/migrations/0010_packing.sql`
- Modify: `backend/src/test/helpers.ts`

- [ ] **Step 1: Write the migration**

Create `backend/src/db/migrations/0010_packing.sql`:
```sql
-- Packing: templates (no trip) and per-trip lists, with categorized items.
CREATE TABLE packing_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID REFERENCES families(id) ON DELETE CASCADE,  -- NULL for built-in templates
  trip_id     UUID REFERENCES trips(id) ON DELETE CASCADE,     -- NULL for templates
  name        TEXT NOT NULL,
  is_builtin  BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_packing_lists_family ON packing_lists(family_id);
CREATE INDEX idx_packing_lists_trip ON packing_lists(trip_id);

CREATE TABLE packing_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     UUID NOT NULL REFERENCES packing_lists(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  qty         INTEGER,
  checked     BOOLEAN NOT NULL DEFAULT false,
  seq         INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_packing_items_list ON packing_items(list_id);
```

- [ ] **Step 2: Add `packing_lists` to the test reset list**

Built-in packing templates have `family_id IS NULL`, so the family-cascade truncation won't clear them. In `backend/src/test/helpers.ts`, add `"packing_lists"` to the `APP_TABLES` array (anywhere in the list; `packing_items` cascades via its FK):
```ts
const APP_TABLES = [
  "links", "comments", "visit_waypoints", "map_set_visits",
  "media", "documents", "visits", "trips", "people", "packing_lists",
  "icons", "themes", "map_sets", "share_links", "users", "families",
];
```

- [ ] **Step 3: Apply + confirm**

Run:
```bash
cd backend && npm run migrate && npm test -- src/test/harness.test.ts
```
Expected: `[migrate] applying 0010_packing.sql`; harness test PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/0010_packing.sql backend/src/test/helpers.ts
git commit -m "feat(db): packing_lists + packing_items; reset packing in tests"
```

---

## Task 2: Built-in templates seed

**Files:**
- Modify: `backend/src/db/seed.ts`
- Test: `backend/src/db/seed-packing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/db/seed-packing.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "./pool.js";
import { seedPacking } from "./seed.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

test("seedPacking inserts built-in templates with items, idempotently", async () => {
  await seedPacking();
  await seedPacking(); // second run must not duplicate
  const lists = await query<{ n: string }>("SELECT COUNT(*)::int AS n FROM packing_lists WHERE is_builtin = true");
  expect(Number(lists.rows[0].n)).toBeGreaterThanOrEqual(3);
  const carry = await query<{ id: string }>("SELECT id FROM packing_lists WHERE is_builtin = true AND name = 'Carry-on essentials'");
  expect(carry.rowCount).toBe(1);
  const items = await query("SELECT 1 FROM packing_items WHERE list_id = $1", [carry.rows[0].id]);
  expect(items.rowCount).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/db/seed-packing.test.ts`
Expected: FAIL (`seedPacking` not exported).

- [ ] **Step 3: Implement `seedPacking`**

In `backend/src/db/seed.ts`, add the data + an exported function, and call it from `seed()`:
```ts
const BUILTIN_PACKING: { name: string; items: { label: string; category: string }[] }[] = [
  { name: "Carry-on essentials", items: [
    { label: "Passport", category: "Documents" }, { label: "Wallet", category: "Documents" },
    { label: "Phone charger", category: "Electronics" }, { label: "Headphones", category: "Electronics" },
    { label: "Toothbrush", category: "Toiletries" }, { label: "Medications", category: "Toiletries" },
  ] },
  { name: "Beach trip", items: [
    { label: "Swimsuit", category: "Clothes" }, { label: "Sandals", category: "Clothes" },
    { label: "Sunscreen", category: "Toiletries" }, { label: "Sunglasses", category: "Misc" },
    { label: "Beach towel", category: "Misc" },
  ] },
  { name: "Winter", items: [
    { label: "Heavy coat", category: "Clothes" }, { label: "Gloves", category: "Clothes" },
    { label: "Thermal layers", category: "Clothes" }, { label: "Lip balm", category: "Toiletries" },
  ] },
];

export async function seedPacking(): Promise<void> {
  for (const tpl of BUILTIN_PACKING) {
    const existing = await pool.query("SELECT id FROM packing_lists WHERE family_id IS NULL AND is_builtin = true AND name = $1", [tpl.name]);
    if (existing.rowCount) continue;
    const ins = await pool.query<{ id: string }>(
      "INSERT INTO packing_lists (family_id, trip_id, name, is_builtin) VALUES (NULL, NULL, $1, true) RETURNING id", [tpl.name]);
    const listId = ins.rows[0].id;
    for (let i = 0; i < tpl.items.length; i++) {
      await pool.query("INSERT INTO packing_items (list_id, label, category, seq) VALUES ($1,$2,$3,$4)", [listId, tpl.items[i].label, tpl.items[i].category, i]);
    }
  }
  console.log(`[seed] built-in packing templates ensured (${BUILTIN_PACKING.length})`);
}
```
Add `await seedPacking();` to the exported `seed()` function (after `await seedThemes();`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/db/seed-packing.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/seed.ts backend/src/db/seed-packing.test.ts
git commit -m "feat(seed): built-in packing templates"
```

---

## Task 3: Templates list + list detail

**Files:**
- Create: `backend/src/routes/packing.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/routes/packing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/packing.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let builtinId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  builtinId = (await query<{ id: string }>(
    "INSERT INTO packing_lists (family_id, trip_id, name, is_builtin) VALUES (NULL, NULL, 'Beach', true) RETURNING id", [])).rows[0].id;
  await query("INSERT INTO packing_items (list_id, label, category, seq) VALUES ($1,'Swimsuit','Clothes',0)", [builtinId]);
  // a family template
  await query("INSERT INTO packing_lists (family_id, name) VALUES ($1,'My template')", [ctx.familyId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("templates lists built-ins + family templates with item counts", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/packing/templates", headers: auth() });
  const names = res.json().map((l: any) => l.name).sort();
  expect(names).toEqual(["Beach", "My template"]);
  const beach = res.json().find((l: any) => l.name === "Beach");
  expect(beach).toMatchObject({ isBuiltin: true, itemCount: 1 });
});

test("a list detail returns its items", async () => {
  const res = await ctx.app.inject({ method: "GET", url: `/api/packing/lists/${builtinId}`, headers: auth() });
  expect(res.json().items).toHaveLength(1);
  expect(res.json().items[0]).toMatchObject({ label: "Swimsuit", category: "Clothes" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/packing.test.ts`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement `packing.ts` (helpers + templates + detail)**

Create `backend/src/routes/packing.ts`:
```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

interface ListRow { id: string; name: string; trip_id: string | null; is_builtin: boolean; item_count: number; checked_count: number; }
interface ItemRow { id: string; label: string; category: string; qty: number | null; checked: boolean; seq: number; }

const summaryDto = (r: ListRow) => ({ id: r.id, name: r.name, tripId: r.trip_id, isBuiltin: r.is_builtin, itemCount: r.item_count, checkedCount: r.checked_count });
const itemDto = (r: ItemRow) => ({ id: r.id, label: r.label, category: r.category, qty: r.qty, checked: r.checked, seq: r.seq });

const SUMMARY = `
  SELECT l.id, l.name, l.trip_id, l.is_builtin,
    (SELECT COUNT(*)::int FROM packing_items WHERE list_id = l.id) AS item_count,
    (SELECT COUNT(*)::int FROM packing_items WHERE list_id = l.id AND checked) AS checked_count
  FROM packing_lists l`;

/** A list the family may *see* (its own, or a built-in). */
async function loadVisible(familyId: string, id: string): Promise<ListRow | null> {
  const { rows } = await query<ListRow>(`${SUMMARY} WHERE l.id = $1 AND (l.family_id = $2 OR l.is_builtin)`, [id, familyId]);
  return rows[0] ?? null;
}
async function itemsOf(listId: string) {
  const { rows } = await query<ItemRow>("SELECT id, label, category, qty, checked, seq FROM packing_items WHERE list_id = $1 ORDER BY category ASC, seq ASC, created_at ASC", [listId]);
  return rows.map(itemDto);
}

export async function packingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/packing/templates", async (req) => {
    const { rows } = await query<ListRow>(
      `${SUMMARY} WHERE l.trip_id IS NULL AND (l.family_id = $1 OR l.is_builtin) ORDER BY l.is_builtin ASC, l.name ASC`, [req.user.familyId]);
    return rows.map(summaryDto);
  });

  app.get("/api/packing/lists/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const list = await loadVisible(req.user.familyId, id);
    if (!list) return reply.code(404).send({ error: "Not found" });
    return { ...summaryDto(list), items: await itemsOf(id) };
  });
}
```

- [ ] **Step 4: Register the route**

In `backend/src/index.ts`, add `import { packingRoutes } from "./routes/packing.js";` and `await app.register(packingRoutes);`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/packing.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/packing.ts backend/src/routes/packing.test.ts backend/src/index.ts
git commit -m "feat(packing): templates list + list detail"
```

---

## Task 4: Items + list mutations (built-in read-only)

**Files:**
- Modify: `backend/src/routes/packing.ts`
- Test: `backend/src/routes/packing-mutate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/packing-mutate.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let listId: string, builtinId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  listId = (await query<{ id: string }>("INSERT INTO packing_lists (family_id, name) VALUES ($1,'Mine') RETURNING id", [ctx.familyId])).rows[0].id;
  builtinId = (await query<{ id: string }>("INSERT INTO packing_lists (family_id, trip_id, name, is_builtin) VALUES (NULL,NULL,'Beach',true) RETURNING id", [])).rows[0].id;
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("adds, checks, and deletes an item on a family list", async () => {
  const add = await ctx.app.inject({ method: "POST", url: `/api/packing/lists/${listId}/items`, headers: auth(), payload: { label: "Socks", category: "Clothes", qty: 5 } });
  expect(add.statusCode).toBe(201);
  const itemId = add.json().id;
  const check = await ctx.app.inject({ method: "PATCH", url: `/api/packing/items/${itemId}`, headers: auth(), payload: { checked: true } });
  expect(check.json().checked).toBe(true);
  const del = await ctx.app.inject({ method: "DELETE", url: `/api/packing/items/${itemId}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});

test("built-in lists are read-only (403)", async () => {
  const res = await ctx.app.inject({ method: "POST", url: `/api/packing/lists/${builtinId}/items`, headers: auth(), payload: { label: "x" } });
  expect(res.statusCode).toBe(403);
});

test("renames and deletes a family list", async () => {
  const rn = await ctx.app.inject({ method: "PATCH", url: `/api/packing/lists/${listId}`, headers: auth(), payload: { name: "Renamed" } });
  expect(rn.json().name).toBe("Renamed");
  const del = await ctx.app.inject({ method: "DELETE", url: `/api/packing/lists/${listId}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/packing-mutate.test.ts`
Expected: FAIL (routes missing).

- [ ] **Step 3: Add a mutation guard + handlers**

In `backend/src/routes/packing.ts`, add a guard helper and the handlers inside `packingRoutes`:
```ts
  // Returns null=404, "builtin"=403, or the row for a family-owned (non-builtin) list.
  async function loadMutable(familyId: string, id: string): Promise<ListRow | "builtin" | null> {
    const list = await loadVisible(familyId, id);
    if (!list) return null;
    if (list.is_builtin) return "builtin";
    return list;
  }
  function guardReply(reply: import("fastify").FastifyReply, r: ListRow | "builtin" | null): boolean {
    if (r === null) { reply.code(404).send({ error: "Not found" }); return false; }
    if (r === "builtin") { reply.code(403).send({ error: "Built-in lists are read-only" }); return false; }
    return true;
  }

  app.post("/api/packing/lists/:id/items", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const g = await loadMutable(req.user.familyId, id);
    if (!guardReply(reply, g)) return;
    const parsed = z.object({ label: z.string().min(1).max(200), category: z.string().max(80).optional(), qty: z.coerce.number().int().nullish() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const seq = await query<{ seq: number }>("SELECT COALESCE(MAX(seq),-1)+1 AS seq FROM packing_items WHERE list_id = $1", [id]);
    const { rows } = await query<ItemRow>(
      "INSERT INTO packing_items (list_id, label, category, qty, seq) VALUES ($1,$2,$3,$4,$5) RETURNING id, label, category, qty, checked, seq",
      [id, b.label, b.category ?? "", b.qty ?? null, seq.rows[0].seq]);
    return reply.code(201).send(itemDto(rows[0]));
  });

  app.patch("/api/packing/items/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const owner = await query<{ list_id: string }>(
      `SELECT i.list_id FROM packing_items i JOIN packing_lists l ON l.id = i.list_id
       WHERE i.id = $1 AND l.family_id = $2 AND l.is_builtin = false`, [id, req.user.familyId]);
    if (!owner.rowCount) return reply.code(404).send({ error: "Not found" });
    const parsed = z.object({
      label: z.string().min(1).max(200).optional(), category: z.string().max(80).optional(),
      qty: z.coerce.number().int().nullish(), checked: z.boolean().optional(), seq: z.coerce.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    const { rows } = await query<ItemRow>(
      `UPDATE packing_items SET label = COALESCE($2,label), category = COALESCE($3,category),
         qty = CASE WHEN $4::boolean THEN $5 ELSE qty END,
         checked = COALESCE($6,checked), seq = COALESCE($7,seq)
       WHERE id = $1 RETURNING id, label, category, qty, checked, seq`,
      [id, b.label ?? null, b.category ?? null, has("qty"), b.qty ?? null, b.checked ?? null, b.seq ?? null]);
    return itemDto(rows[0]);
  });

  app.delete("/api/packing/items/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query(
      `DELETE FROM packing_items i USING packing_lists l
       WHERE i.id = $1 AND l.id = i.list_id AND l.family_id = $2 AND l.is_builtin = false`, [id, req.user.familyId]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });

  app.patch("/api/packing/lists/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const g = await loadMutable(req.user.familyId, id);
    if (!guardReply(reply, g)) return;
    const parsed = z.object({ name: z.string().min(1).max(160) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await query("UPDATE packing_lists SET name = $1 WHERE id = $2", [parsed.data.name, id]);
    return summaryDto((await loadVisible(req.user.familyId, id))!);
  });

  app.delete("/api/packing/lists/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const g = await loadMutable(req.user.familyId, id);
    if (!guardReply(reply, g)) return;
    await query("DELETE FROM packing_lists WHERE id = $1", [id]);
    return reply.code(204).send();
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/packing-mutate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/packing.ts backend/src/routes/packing-mutate.test.ts
git commit -m "feat(packing): item CRUD + list rename/delete (built-in read-only)"
```

---

## Task 5: Trip list (seed) + save-as-template

**Files:**
- Modify: `backend/src/routes/packing.ts`
- Test: `backend/src/routes/packing-trip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/packing-trip.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string, templateId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  tripId = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1,'Italy') RETURNING id", [ctx.familyId])).rows[0].id;
  templateId = (await query<{ id: string }>("INSERT INTO packing_lists (family_id, name) VALUES ($1,'Base') RETURNING id", [ctx.familyId])).rows[0].id;
  await query("INSERT INTO packing_items (list_id, label, category, checked, seq) VALUES ($1,'Passport','Docs',true,0)", [templateId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("a trip with no list returns null, then seeds from a template (items unchecked)", async () => {
  const empty = await ctx.app.inject({ method: "GET", url: `/api/trips/${tripId}/packing`, headers: auth() });
  expect(empty.json().list).toBeNull();

  const create = await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/packing`, headers: auth(), payload: { fromTemplateId: templateId } });
  expect(create.statusCode).toBe(201);
  expect(create.json().items).toHaveLength(1);
  expect(create.json().items[0]).toMatchObject({ label: "Passport", checked: false }); // copied, unchecked

  // idempotent: second POST returns the existing list
  const again = await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/packing`, headers: auth(), payload: {} });
  expect(again.json().id).toBe(create.json().id);
});

test("saves a list as a template (items copied, unchecked)", async () => {
  const get = await ctx.app.inject({ method: "GET", url: `/api/trips/${tripId}/packing`, headers: auth() });
  const listId = get.json().list.id;
  // check the trip item so we can prove the template copy is reset
  await query("UPDATE packing_items SET checked = true WHERE list_id = $1", [listId]);

  const tpl = await ctx.app.inject({ method: "POST", url: "/api/packing/templates", headers: auth(), payload: { name: "Italy base", fromListId: listId } });
  expect(tpl.statusCode).toBe(201);
  const tplId = tpl.json().id;
  const items = await query<{ checked: boolean }>("SELECT checked FROM packing_items WHERE list_id = $1", [tplId]);
  expect(items.rows.every((r) => r.checked === false)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/packing-trip.test.ts`
Expected: FAIL (routes missing).

- [ ] **Step 3: Add trip + template-create handlers**

In `backend/src/routes/packing.ts`, extend the pool import with `tx`, and add the handlers inside `packingRoutes`:
```ts
// at top:
import { query, tx } from "../db/pool.js";
```
```ts
  async function ownsTrip(familyId: string, tripId: string): Promise<boolean> {
    const { rowCount } = await query("SELECT 1 FROM trips WHERE id = $1 AND family_id = $2", [tripId, familyId]);
    return Boolean(rowCount);
  }
  // Copy items from a visible source list into a destination list, unchecked.
  async function copyItems(client: import("pg").PoolClient, destId: string, sourceId: string) {
    await client.query(
      `INSERT INTO packing_items (list_id, label, category, qty, checked, seq)
       SELECT $1, label, category, qty, false, seq FROM packing_items WHERE list_id = $2 ORDER BY seq`,
      [destId, sourceId]);
  }

  app.get("/api/trips/:tripId/packing", async (req, reply) => {
    const tripId = (req.params as { tripId: string }).tripId;
    if (!(await ownsTrip(req.user.familyId, tripId))) return reply.code(404).send({ error: "Trip not found" });
    const { rows } = await query<ListRow>(`${SUMMARY} WHERE l.trip_id = $1 AND l.family_id = $2 LIMIT 1`, [tripId, req.user.familyId]);
    if (!rows[0]) return { list: null };
    return { list: { ...summaryDto(rows[0]), items: await itemsOf(rows[0].id) } };
  });

  app.post("/api/trips/:tripId/packing", async (req, reply) => {
    const tripId = (req.params as { tripId: string }).tripId;
    if (!(await ownsTrip(req.user.familyId, tripId))) return reply.code(404).send({ error: "Trip not found" });
    const existing = await query<{ id: string }>("SELECT id FROM packing_lists WHERE trip_id = $1 AND family_id = $2 LIMIT 1", [tripId, req.user.familyId]);
    if (existing.rows[0]) {
      const list = await loadVisible(req.user.familyId, existing.rows[0].id);
      return reply.code(200).send({ ...summaryDto(list!), items: await itemsOf(existing.rows[0].id) });
    }
    const parsed = z.object({ name: z.string().max(160).optional(), fromTemplateId: z.string().uuid().optional(), fromTripId: z.string().uuid().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;

    // Resolve a source list id (a visible template, or another trip's list).
    let sourceId: string | null = null;
    if (b.fromTemplateId) { if (!(await loadVisible(req.user.familyId, b.fromTemplateId))) return reply.code(404).send({ error: "Template not found" }); sourceId = b.fromTemplateId; }
    else if (b.fromTripId) {
      const src = await query<{ id: string }>("SELECT id FROM packing_lists WHERE trip_id = $1 AND family_id = $2 LIMIT 1", [b.fromTripId, req.user.familyId]);
      if (!src.rows[0]) return reply.code(404).send({ error: "Source trip has no packing list" });
      sourceId = src.rows[0].id;
    }

    const id = await tx(async (client) => {
      const ins = await client.query<{ id: string }>(
        "INSERT INTO packing_lists (family_id, trip_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id",
        [req.user.familyId, tripId, b.name ?? "Packing", req.user.id]);
      const newId = ins.rows[0].id;
      if (sourceId) await copyItems(client, newId, sourceId);
      return newId;
    });
    const list = await loadVisible(req.user.familyId, id);
    return reply.code(201).send({ ...summaryDto(list!), items: await itemsOf(id) });
  });

  app.post("/api/packing/templates", async (req, reply) => {
    const parsed = z.object({ name: z.string().min(1).max(160), fromListId: z.string().uuid().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    if (b.fromListId && !(await loadVisible(req.user.familyId, b.fromListId))) return reply.code(404).send({ error: "Source list not found" });
    const id = await tx(async (client) => {
      const ins = await client.query<{ id: string }>(
        "INSERT INTO packing_lists (family_id, trip_id, name, created_by) VALUES ($1,NULL,$2,$3) RETURNING id",
        [req.user.familyId, b.name, req.user.id]);
      const newId = ins.rows[0].id;
      if (b.fromListId) await copyItems(client, newId, b.fromListId);
      return newId;
    });
    const list = await loadVisible(req.user.familyId, id);
    return reply.code(201).send({ ...summaryDto(list!), items: await itemsOf(id) });
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/packing-trip.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/packing.ts backend/src/routes/packing-trip.test.ts
git commit -m "feat(packing): trip list (seed from template/trip) + save-as-template"
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
git commit -m "chore: phase 7A packing backend verified" || echo "nothing to commit"
```

---

## Notes for Plan 7B (frontend)

- `GET /api/packing/templates` → `PackingList[]` summaries (`{ id, name, tripId, isBuiltin, itemCount, checkedCount }`).
- `GET /api/packing/lists/:id` → a summary + `items: PackingItem[]` (`{ id, label, category, qty, checked, seq }`).
- `POST /api/packing/lists/:id/items`, `PATCH /api/packing/items/:id` (incl. `{ checked }`), `DELETE /api/packing/items/:id`.
- `PATCH /api/packing/lists/:id` (rename), `DELETE /api/packing/lists/:id`.
- `GET /api/trips/:tripId/packing` → `{ list: (summary & { items }) | null }`. `POST /api/trips/:tripId/packing` `{ name?, fromTemplateId?, fromTripId? }` → the list (201 new / 200 existing).
- `POST /api/packing/templates` `{ name, fromListId? }` → the new template (with items).
- Built-in lists (`isBuiltin`) are read-only — render their checklist without edit controls.
