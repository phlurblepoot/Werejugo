# Phase 2A — People & Entity-Relations Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend the People module and the shared UI components need: `people` CRUD (with signed avatar URLs and optional account linking), a **relations** endpoint that resolves an entity's links to displayable summaries (for `RelatedPanel`), and an **entity-search** endpoint (for `EntityPicker`).

**Architecture:** Three new route surfaces on the existing Fastify app, all family-scoped and following the established route pattern (`zod` validation, snake→camel DTOs, `requireAuth`, 404 on cross-family). `people` CRUD mirrors `themes.ts`/`trips.ts`. The relations + search endpoints read the Phase-1 `links` table and resolve refs (`"type:id"`) to summaries `{ type, id, label, subtitle?, thumbUrl? }`, using `signFileUrl` for media/avatars. No schema changes — the `people`, `media`, `links` tables already exist from Phase 1.

**Tech Stack:** Fastify 5 (ESM, `.js` import suffixes), PostgreSQL via `pg`, `zod`, `@fastify/jwt`. Tests: Vitest against the Phase-1 test DB harness (`buildTestApp`/`resetDb`).

**Scope note:** This is **Plan 2A** of Phase 2. It delivers API-testable backend. **Plan 2B** (frontend client methods, the five shared components `MediaUploader`/`EntityPicker`/`RelatedPanel`/`EntityList`/`EntityDetail`, and the People module page) consumes these endpoints. No frontend work here.

---

## Conventions (apply to every task)

- Backend commands run from `backend/`. ESM imports use `.js` suffixes.
- Routes follow the existing shape: `export async function xRoutes(app: FastifyInstance)`, `app.addHook("preHandler", requireAuth)`, `zod` `safeParse` → 400, `req.user.familyId`/`req.user.id` scoping, snake→camel DTOs, 404 on cross-family.
- Each new route file is registered in `backend/src/index.ts` in the task that creates it.
- Commit after each task with the message in its final step. The Phase-1 test DB + vitest config are already set up and working.

---

## File Structure

**New files:**
- `backend/src/routes/people.ts` — People CRUD + a family-members helper endpoint.
- `backend/src/routes/relations.ts` — `GET /api/relations` (resolve an entity's links to summaries) and `GET /api/entities/search` (search entities by type).

**Modified files:**
- `backend/src/index.ts` — register `peopleRoutes` and `relationRoutes`.

**Reused (no change):** `people`/`media`/`links` tables, `lib/refs.ts` (`parseRef`, `CORE_TYPES`, `TABLE_FOR`), `lib/filesign.ts` (`signFileUrl`).

---

## Task 1: People CRUD routes

**Files:**
- Create: `backend/src/routes/people.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/routes/people.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/people.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates, lists, updates, and deletes a person", async () => {
  const create = await ctx.app.inject({
    method: "POST", url: "/api/people", headers: auth(),
    payload: { displayName: "Grandma", relationship: "Family" },
  });
  expect(create.statusCode).toBe(201);
  const id = create.json().id;
  expect(create.json()).toMatchObject({ displayName: "Grandma", relationship: "Family", avatarUrl: null });

  const list = await ctx.app.inject({ method: "GET", url: "/api/people", headers: auth() });
  expect(list.json()).toHaveLength(1);

  const patch = await ctx.app.inject({
    method: "PATCH", url: `/api/people/${id}`, headers: auth(), payload: { relationship: "Grandmother" } });
  expect(patch.json().relationship).toBe("Grandmother");

  const del = await ctx.app.inject({ method: "DELETE", url: `/api/people/${id}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});

test("a person's avatar resolves to a signed url", async () => {
  const m = await query<{ id: string }>(
    "INSERT INTO media (family_id, kind, rel_path, thumb_rel_path) VALUES ($1,'image','loose/2024/a.jpg','loose/2024/a.thumb.jpg') RETURNING id",
    [ctx.familyId]);
  const create = await ctx.app.inject({
    method: "POST", url: "/api/people", headers: auth(),
    payload: { displayName: "Dad", avatarMediaId: m.rows[0].id } });
  expect(create.json().avatarUrl).toContain("/api/files/");
  expect(create.json().avatarUrl).toContain("sig=");
});

test("rejects an avatar that isn't the family's media", async () => {
  const res = await ctx.app.inject({
    method: "POST", url: "/api/people", headers: auth(),
    payload: { displayName: "X", avatarMediaId: "11111111-1111-1111-1111-111111111111" } });
  expect(res.statusCode).toBe(404);
});

test("lists family members for account linking", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/family-members", headers: auth() });
  expect(res.statusCode).toBe(200);
  expect(res.json()[0]).toMatchObject({ displayName: "Owner" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/people.test.ts`
Expected: FAIL (routes not registered).

- [ ] **Step 3: Implement `people.ts`**

Create `backend/src/routes/people.ts`:
```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { signFileUrl } from "../lib/filesign.js";

interface PersonRow {
  id: string; display_name: string; relationship: string; notes: string;
  user_id: string | null; avatar_media_id: string | null;
  avatar_rel: string | null; avatar_thumb: string | null; created_at: string;
}

function toDto(r: PersonRow) {
  const avatarRel = r.avatar_thumb ?? r.avatar_rel;
  return {
    id: r.id,
    displayName: r.display_name,
    relationship: r.relationship,
    notes: r.notes,
    userId: r.user_id,
    avatarMediaId: r.avatar_media_id,
    avatarUrl: avatarRel ? signFileUrl(avatarRel) : null,
    createdAt: r.created_at,
  };
}

const SELECT = `
  SELECT p.id, p.display_name, p.relationship, p.notes, p.user_id, p.avatar_media_id,
         m.rel_path AS avatar_rel, m.thumb_rel_path AS avatar_thumb, p.created_at
  FROM people p LEFT JOIN media m ON m.id = p.avatar_media_id`;

const upsertSchema = z.object({
  displayName: z.string().min(1).max(160),
  relationship: z.string().max(160).optional(),
  notes: z.string().max(4000).optional(),
  userId: z.string().uuid().nullish(),
  avatarMediaId: z.string().uuid().nullish(),
});

async function ownsId(table: "media" | "users", id: string, familyId: string): Promise<boolean> {
  const { rowCount } = await query(`SELECT 1 FROM ${table} WHERE id = $1 AND family_id = $2`, [id, familyId]);
  return Boolean(rowCount);
}

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/people", async (req) => {
    const { rows } = await query<PersonRow>(
      `${SELECT} WHERE p.family_id = $1 ORDER BY p.display_name ASC`, [req.user.familyId]);
    return rows.map(toDto);
  });

  app.get("/api/people/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const { rows } = await query<PersonRow>(
      `${SELECT} WHERE p.id = $1 AND p.family_id = $2`, [id, req.user.familyId]);
    if (!rows[0]) return reply.code(404).send({ error: "Not found" });
    return toDto(rows[0]);
  });

  app.post("/api/people", async (req, reply) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    if (b.avatarMediaId && !(await ownsId("media", b.avatarMediaId, req.user.familyId)))
      return reply.code(404).send({ error: "Avatar media not found" });
    if (b.userId && !(await ownsId("users", b.userId, req.user.familyId)))
      return reply.code(404).send({ error: "User not found" });
    const ins = await query<{ id: string }>(
      `INSERT INTO people (family_id, display_name, relationship, notes, user_id, avatar_media_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user.familyId, b.displayName, b.relationship ?? "", b.notes ?? "", b.userId ?? null, b.avatarMediaId ?? null]);
    const { rows } = await query<PersonRow>(`${SELECT} WHERE p.id = $1`, [ins.rows[0].id]);
    return reply.code(201).send(toDto(rows[0]));
  });

  app.patch("/api/people/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const owns = await query("SELECT 1 FROM people WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!owns.rowCount) return reply.code(404).send({ error: "Not found" });
    const parsed = upsertSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    if (b.avatarMediaId && !(await ownsId("media", b.avatarMediaId, req.user.familyId)))
      return reply.code(404).send({ error: "Avatar media not found" });
    if (b.userId && !(await ownsId("users", b.userId, req.user.familyId)))
      return reply.code(404).send({ error: "User not found" });
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    await query(
      `UPDATE people SET
         display_name = COALESCE($3, display_name),
         relationship = COALESCE($4, relationship),
         notes = COALESCE($5, notes),
         user_id = CASE WHEN $6::boolean THEN $7 ELSE user_id END,
         avatar_media_id = CASE WHEN $8::boolean THEN $9 ELSE avatar_media_id END
       WHERE id = $1 AND family_id = $2`,
      [id, req.user.familyId, b.displayName ?? null, b.relationship ?? null, b.notes ?? null,
       has("userId"), b.userId ?? null, has("avatarMediaId"), b.avatarMediaId ?? null]);
    const { rows } = await query<PersonRow>(`${SELECT} WHERE p.id = $1`, [id]);
    return toDto(rows[0]);
  });

  app.delete("/api/people/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM people WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });

  // Family users available to link a Person to an account.
  app.get("/api/family-members", async (req) => {
    const { rows } = await query<{ id: string; display_name: string; email: string; color: string }>(
      "SELECT id, display_name, email, color FROM users WHERE family_id = $1 ORDER BY display_name ASC",
      [req.user.familyId]);
    return rows.map((r) => ({ id: r.id, displayName: r.display_name, email: r.email, color: r.color }));
  });
}
```

- [ ] **Step 4: Register the route in `index.ts`**

In `backend/src/index.ts`, add `import { peopleRoutes } from "./routes/people.js";` and `await app.register(peopleRoutes);` (near the other route registrations).

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/people.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/people.ts backend/src/routes/people.test.ts backend/src/index.ts
git commit -m "feat(people): CRUD routes with signed avatars + family-members list"
```

---

## Task 2: Relations endpoint (resolve links to summaries)

**Files:**
- Create: `backend/src/routes/relations.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/routes/relations.test.ts`

`RelatedPanel` needs, for an entity, its linked entities with enough to render (type, id, label, optional subtitle, optional thumbnail). This endpoint resolves the Phase-1 `links` rows to those summaries.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/relations.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("resolves a person's links to entity summaries", async () => {
  const person = await query<{ id: string }>(
    "INSERT INTO people (family_id, display_name) VALUES ($1,'Mom') RETURNING id", [ctx.familyId]);
  const visit = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title, occurred_on) VALUES ($1,'place','Eiffel Tower','2024-06-02') RETURNING id", [ctx.familyId]);
  const media = await query<{ id: string }>(
    "INSERT INTO media (family_id, kind, rel_path, thumb_rel_path, caption) VALUES ($1,'image','loose/2024/a.jpg','loose/2024/a.thumb.jpg','Selfie') RETURNING id", [ctx.familyId]);
  await query(`INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role)
               VALUES ($1,'person',$2,'visit',$3,'visited'), ($1,'media',$4,'person',$2,'shows')`,
    [ctx.familyId, person.rows[0].id, visit.rows[0].id, media.rows[0].id]);

  const res = await ctx.app.inject({
    method: "GET", url: `/api/relations?entity=person:${person.rows[0].id}`, headers: auth() });
  expect(res.statusCode).toBe(200);
  const rels = res.json();
  expect(rels).toHaveLength(2);
  const byType = Object.fromEntries(rels.map((r: any) => [r.entity.type, r.entity]));
  expect(byType.visit).toMatchObject({ label: "Eiffel Tower" });
  expect(byType.media.thumbUrl).toContain("/api/files/");
});

test("rejects a malformed entity ref", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/relations?entity=bad", headers: auth() });
  expect(res.statusCode).toBe(400);
});

test("404 for an entity in another family", async () => {
  const res = await ctx.app.inject({
    method: "GET", url: "/api/relations?entity=person:11111111-1111-1111-1111-111111111111", headers: auth() });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/relations.test.ts`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement `relations.ts`**

Create `backend/src/routes/relations.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { parseRef, TABLE_FOR, type CoreType } from "../lib/refs.js";
import { signFileUrl } from "../lib/filesign.js";

export interface EntitySummary {
  type: CoreType; id: string; label: string; subtitle: string | null; thumbUrl: string | null;
}

/** Resolve a set of ids of one type to display summaries. */
async function summariesFor(familyId: string, type: CoreType, ids: string[]): Promise<Map<string, EntitySummary>> {
  const out = new Map<string, EntitySummary>();
  if (ids.length === 0) return out;
  if (type === "visit") {
    const { rows } = await query<any>(
      "SELECT id, title, occurred_on FROM visits WHERE family_id = $1 AND id = ANY($2::uuid[])", [familyId, ids]);
    for (const r of rows) out.set(r.id, { type, id: r.id, label: r.title, subtitle: r.occurred_on, thumbUrl: null });
  } else if (type === "trip") {
    const { rows } = await query<any>(
      "SELECT id, name, start_date, cover_photo_url FROM trips WHERE family_id = $1 AND id = ANY($2::uuid[])", [familyId, ids]);
    for (const r of rows) out.set(r.id, { type, id: r.id, label: r.name, subtitle: r.start_date, thumbUrl: r.cover_photo_url ?? null });
  } else if (type === "person") {
    const { rows } = await query<any>(
      `SELECT p.id, p.display_name, p.relationship, m.rel_path, m.thumb_rel_path
       FROM people p LEFT JOIN media m ON m.id = p.avatar_media_id
       WHERE p.family_id = $1 AND p.id = ANY($2::uuid[])`, [familyId, ids]);
    for (const r of rows) {
      const rel = r.thumb_rel_path ?? r.rel_path;
      out.set(r.id, { type, id: r.id, label: r.display_name, subtitle: r.relationship || null, thumbUrl: rel ? signFileUrl(rel) : null });
    }
  } else if (type === "media") {
    const { rows } = await query<any>(
      "SELECT id, caption, original_name, rel_path, thumb_rel_path FROM media WHERE family_id = $1 AND id = ANY($2::uuid[])", [familyId, ids]);
    for (const r of rows) {
      const rel = r.thumb_rel_path ?? r.rel_path;
      out.set(r.id, { type, id: r.id, label: r.caption || r.original_name || "Photo", subtitle: null, thumbUrl: rel ? signFileUrl(rel) : null });
    }
  } else if (type === "document") {
    const { rows } = await query<any>(
      "SELECT id, title, doc_type FROM documents WHERE family_id = $1 AND id = ANY($2::uuid[])", [familyId, ids]);
    for (const r of rows) out.set(r.id, { type, id: r.id, label: r.title, subtitle: r.doc_type, thumbUrl: null });
  }
  return out;
}

export async function relationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/relations", async (req, reply) => {
    const ref = parseRef((req.query as { entity?: string }).entity ?? "");
    if (!ref) return reply.code(400).send({ error: "Invalid entity reference" });
    const owns = await query(`SELECT 1 FROM ${TABLE_FOR[ref.type]} WHERE id = $1 AND family_id = $2`, [ref.id, req.user.familyId]);
    if (!owns.rowCount) return reply.code(404).send({ error: "Entity not found" });

    const { rows } = await query<any>(
      `SELECT id, from_type, from_id, to_type, to_id, role FROM links
       WHERE family_id = $1 AND ((from_type = $2 AND from_id = $3) OR (to_type = $2 AND to_id = $3))
       ORDER BY created_at ASC`,
      [req.user.familyId, ref.type, ref.id]);

    // Compute the "other" ref for each link, then batch-resolve summaries per type.
    const others = rows.map((r) => {
      const isFrom = r.from_type === ref.type && r.from_id === ref.id;
      return { linkId: r.id, role: r.role, type: (isFrom ? r.to_type : r.from_type) as CoreType, id: isFrom ? r.to_id : r.from_id };
    });
    const byType = new Map<CoreType, string[]>();
    for (const o of others) byType.set(o.type, [...(byType.get(o.type) ?? []), o.id]);
    const resolved = new Map<string, EntitySummary>();
    for (const [type, ids] of byType) for (const [id, s] of await summariesFor(req.user.familyId, type, ids)) resolved.set(`${type}:${id}`, s);

    return others
      .map((o) => ({ linkId: o.linkId, role: o.role, entity: resolved.get(`${o.type}:${o.id}`) }))
      .filter((r) => r.entity); // drop any dangling refs
  });
}
```

- [ ] **Step 4: Register the route in `index.ts`**

Add `import { relationRoutes } from "./routes/relations.js";` and `await app.register(relationRoutes);`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/relations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/relations.ts backend/src/routes/relations.test.ts backend/src/index.ts
git commit -m "feat(relations): resolve an entity's links to displayable summaries"
```

---

## Task 3: Entity-search endpoint

**Files:**
- Modify: `backend/src/routes/relations.ts`
- Test: `backend/src/routes/entity-search.test.ts`

`EntityPicker` needs to search entities of a given type by text, to pick something to link.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/entity-search.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await buildTestApp();
  await query("INSERT INTO visits (family_id, kind, title) VALUES ($1,'place','Eiffel Tower'), ($1,'food','Eiffel Cafe')", [ctx.familyId]);
  await query("INSERT INTO people (family_id, display_name) VALUES ($1,'Eileen')", [ctx.familyId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("searches visits by title", async () => {
  const res = await ctx.app.inject({
    method: "GET", url: "/api/entities/search?type=visit&q=eiffel", headers: auth() });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toHaveLength(2);
  expect(res.json()[0]).toMatchObject({ type: "visit" });
});

test("searches people by name", async () => {
  const res = await ctx.app.inject({
    method: "GET", url: "/api/entities/search?type=person&q=eil", headers: auth() });
  expect(res.json()).toHaveLength(1);
  expect(res.json()[0].label).toBe("Eileen");
});

test("rejects an unknown type", async () => {
  const res = await ctx.app.inject({
    method: "GET", url: "/api/entities/search?type=dragon&q=x", headers: auth() });
  expect(res.statusCode).toBe(400);
});

test("empty query returns an empty list", async () => {
  const res = await ctx.app.inject({
    method: "GET", url: "/api/entities/search?type=visit&q=", headers: auth() });
  expect(res.json()).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/entity-search.test.ts`
Expected: FAIL (route missing).

- [ ] **Step 3: Add the search endpoint to `relations.ts`**

Add the import for `CORE_TYPES` (extend the existing refs import) and a new handler inside `relationRoutes`, before its closing brace:
```ts
  app.get("/api/entities/search", async (req, reply) => {
    const { type, q } = req.query as { type?: string; q?: string };
    if (!type || !(CORE_TYPES as readonly string[]).includes(type)) {
      return reply.code(400).send({ error: "Unknown entity type" });
    }
    const term = (q ?? "").trim();
    if (term.length === 0) return [];
    const like = `%${term}%`;
    const fam = req.user.familyId;
    const t = type as CoreType;

    if (t === "visit") {
      const { rows } = await query<any>(
        "SELECT id, title FROM visits WHERE family_id = $1 AND title ILIKE $2 ORDER BY title ASC LIMIT 20", [fam, like]);
      return rows.map((r) => ({ type: t, id: r.id, label: r.title, thumbUrl: null }));
    }
    if (t === "trip") {
      const { rows } = await query<any>(
        "SELECT id, name FROM trips WHERE family_id = $1 AND name ILIKE $2 ORDER BY name ASC LIMIT 20", [fam, like]);
      return rows.map((r) => ({ type: t, id: r.id, label: r.name, thumbUrl: null }));
    }
    if (t === "person") {
      const { rows } = await query<any>(
        `SELECT p.id, p.display_name, m.rel_path, m.thumb_rel_path
         FROM people p LEFT JOIN media m ON m.id = p.avatar_media_id
         WHERE p.family_id = $1 AND p.display_name ILIKE $2 ORDER BY p.display_name ASC LIMIT 20`, [fam, like]);
      return rows.map((r) => {
        const rel = r.thumb_rel_path ?? r.rel_path;
        return { type: t, id: r.id, label: r.display_name, thumbUrl: rel ? signFileUrl(rel) : null };
      });
    }
    if (t === "media") {
      const { rows } = await query<any>(
        `SELECT id, caption, original_name, rel_path, thumb_rel_path FROM media
         WHERE family_id = $1 AND (caption ILIKE $2 OR original_name ILIKE $2) ORDER BY created_at DESC LIMIT 20`, [fam, like]);
      return rows.map((r) => {
        const rel = r.thumb_rel_path ?? r.rel_path;
        return { type: t, id: r.id, label: r.caption || r.original_name || "Photo", thumbUrl: rel ? signFileUrl(rel) : null };
      });
    }
    // document
    const { rows } = await query<any>(
      "SELECT id, title FROM documents WHERE family_id = $1 AND title ILIKE $2 ORDER BY title ASC LIMIT 20", [fam, like]);
    return rows.map((r) => ({ type: t, id: r.id, label: r.title, thumbUrl: null }));
  });
```
Update the refs import at the top of `relations.ts` to include `CORE_TYPES`:
```ts
import { parseRef, TABLE_FOR, CORE_TYPES, type CoreType } from "../lib/refs.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/entity-search.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/relations.ts backend/src/routes/entity-search.test.ts
git commit -m "feat(relations): entity-search endpoint for the entity picker"
```

---

## Task 4: Full backend verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `cd backend && npm test`
Expected: all test files PASS (Phase-1 tests + the three new ones).

- [ ] **Step 2: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit (if any incidental fixes were needed)**

```bash
git add -A backend
git commit -m "chore: phase 2A backend verified" || echo "nothing to commit"
```

---

## Notes for Plan 2B (frontend)

Plan 2B consumes:
- `GET/POST/PATCH/DELETE /api/people`, `GET /api/family-members` — People page + account linking.
- `GET /api/relations?entity=<type:id>` → `[{ linkId, role, entity: { type, id, label, subtitle, thumbUrl } }]` — drives `RelatedPanel`.
- `GET /api/entities/search?type=&q=` → `[{ type, id, label, thumbUrl }]` — drives `EntityPicker`.
- Existing Phase-1 endpoints: `POST /api/media` (upload), `POST /api/links` / `DELETE /api/links/:id` (link/unlink) — drive `MediaUploader` and `RelatedPanel`'s add/remove.

2B will add generic client methods (`listPeople`/`createPerson`/…, `uploadMedia`, `createLink`/`deleteLink`, `getRelations`, `searchEntities`), build the five shared components, and the People module page, then enable the People rail entry.
