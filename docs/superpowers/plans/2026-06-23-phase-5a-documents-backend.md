# Phase 5A — Documents & Reminders Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Documents backend: a PDF-capable file save, a document file-reconciler (owner-change move), and `documents` CRUD with an optional file, a None/Person/Trip owner, computed expiry status, and a `due-count` for the rail badge.

**Architecture:** A small migration makes `documents.rel_path` nullable (files are optional). `saveDocumentUpload` + `reconcileDocument` extend the existing storage/reconcile helpers. A new `documents.ts` route file provides CRUD, the filtered list with computed `status`/`daysUntilExpiry`, an attach-file endpoint, and `due-count`. Family-scoped, `zod`-validated, following the established route pattern.

**Tech Stack:** Fastify 5 (ESM, `.js` suffixes), PostgreSQL/PostGIS via `pg`, `zod`. Tests: Vitest against the Phase-1 test DB harness (`buildTestApp`/`resetDb`).

**Scope note:** Plan **5A** of Phase 5 — API-testable backend. Plan **5B** (DocumentsPage + form/list + rail badge) consumes these endpoints.

---

## Conventions (apply to every task)

- Backend commands run from `backend/`. ESM imports use `.js` suffixes.
- Routes follow the existing shape: `requireAuth` preHandler, `zod` `safeParse` → 400, `req.user.familyId` scoping, snake→camel DTOs, 404 on cross-family.
- The Phase-1 test DB + vitest config are already set up. Commit after each task with the message in its final step.

---

## File Structure

**New files:**
- `backend/src/db/migrations/0008_documents_optional_file.sql` — drop NOT NULL on `documents.rel_path`.
- `backend/src/routes/documents.ts` — documents CRUD + list + due-count + attach-file.

**Modified files:**
- `backend/src/lib/storage.ts` — add `saveDocumentUpload`.
- `backend/src/lib/reconcile.ts` — add `reconcileDocument`.
- `backend/src/index.ts` — register `documentRoutes`.

---

## Task 1: Migration — optional document file

**Files:**
- Create: `backend/src/db/migrations/0008_documents_optional_file.sql`

- [ ] **Step 1: Write the migration**

Create `backend/src/db/migrations/0008_documents_optional_file.sql`:
```sql
-- Documents may exist without a file (track an expiry, attach the scan later).
ALTER TABLE documents ALTER COLUMN rel_path DROP NOT NULL;
```

- [ ] **Step 2: Apply it**

Run:
```bash
cd backend && npm run migrate
```
Expected: `[migrate] applying 0008_documents_optional_file.sql` then `[migrate] up to date`.

- [ ] **Step 3: Confirm the test DB picks it up**

Run: `cd backend && npm test -- src/test/harness.test.ts`
Expected: PASS (the test DB runs all migrations including 0008).

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/0008_documents_optional_file.sql
git commit -m "feat(db): make documents.rel_path nullable (optional file)"
```

---

## Task 2: `saveDocumentUpload`

**Files:**
- Modify: `backend/src/lib/storage.ts`
- Test: `backend/src/lib/storage.doc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/storage.doc.test.ts`:
```ts
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "wj-doc-")); vi.resetModules(); process.env.STORAGE_DIR = dir; });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("saves a PDF into the target dir with a readable name", async () => {
  const { saveDocumentUpload, absStoragePath } = await import("./storage.js");
  const r = await saveDocumentUpload({ filename: "Dad Passport.pdf", file: Readable.from(Buffer.from("%PDF-1.4")) }, "people/dad");
  expect(r.relPath).toBe("people/dad/dad-passport.pdf");
  expect(r.originalName).toBe("Dad Passport.pdf");
  expect(existsSync(absStoragePath(r.relPath))).toBe(true);
});

test("rejects an unsupported type", async () => {
  const { saveDocumentUpload } = await import("./storage.js");
  await expect(saveDocumentUpload({ filename: "x.exe", file: Readable.from(Buffer.from("x")) }, "loose/documents"))
    .rejects.toThrow("UNSUPPORTED_TYPE");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/lib/storage.doc.test.ts`
Expected: FAIL (`saveDocumentUpload` not exported).

- [ ] **Step 3: Implement**

Append to `backend/src/lib/storage.ts` (it already imports `createWriteStream`, `pipeline`, `mkdir`, `extname`, `join`):
```ts
const DOC_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".doc", ".docx"]);

/** Stream a document file (PDF/image/doc) into relDir. No thumbnail. */
export async function saveDocumentUpload(
  part: { filename: string; file: NodeJS.ReadableStream },
  relDir: string,
): Promise<{ relPath: string; originalName: string }> {
  const ext = extname(part.filename).toLowerCase();
  if (!DOC_EXT.has(ext)) throw new Error("UNSUPPORTED_TYPE");
  const name = await uniqueName(relDir, part.filename);
  const relPath = join(relDir, name);
  await mkdir(absStoragePath(relDir), { recursive: true });
  await pipeline(part.file, createWriteStream(absStoragePath(relPath)));
  return { relPath, originalName: part.filename };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/lib/storage.doc.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/storage.ts backend/src/lib/storage.doc.test.ts
git commit -m "feat(storage): saveDocumentUpload (PDF/image/doc)"
```

---

## Task 3: `reconcileDocument`

**Files:**
- Modify: `backend/src/lib/reconcile.ts`
- Test: `backend/src/lib/reconcile.doc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/lib/reconcile.doc.test.ts`:
```ts
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query, tx } from "../db/pool.js";
import { absStoragePath } from "../lib/storage.js";
import { reconcileDocument } from "../lib/reconcile.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

test("moves a document's file when it has a person owner", async () => {
  const person = await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1,'Dad') RETURNING id", [ctx.familyId]);
  const doc = await query<{ id: string }>(
    `INSERT INTO documents (family_id, title, doc_type, rel_path, owner_person_id)
     VALUES ($1,'Passport','passport','loose/documents/passport.pdf',$2) RETURNING id`,
    [ctx.familyId, person.rows[0].id]);
  const abs = absStoragePath("loose/documents/passport.pdf");
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, "%PDF");

  await tx(async (client) => { await reconcileDocument(client, doc.rows[0].id); });

  const row = await query<{ rel_path: string }>("SELECT rel_path FROM documents WHERE id = $1", [doc.rows[0].id]);
  expect(row.rows[0].rel_path).toBe("people/dad/passport.pdf");
  expect(existsSync(absStoragePath("people/dad/passport.pdf"))).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/lib/reconcile.doc.test.ts`
Expected: FAIL (`reconcileDocument` not exported).

- [ ] **Step 3: Implement**

In `backend/src/lib/reconcile.ts`, extend the storage import and add the function:
```ts
// extend the existing import:
import { mediaDirFor, moveStored, documentDirFor } from "./storage.js";
```
```ts
/** Re-home a document file to match its current owner (person/trip/none). Call in a transaction. */
export async function reconcileDocument(client: PoolClient, docId: string): Promise<void> {
  const { rows } = await client.query<{
    rel_path: string | null; person_name: string | null; trip_name: string | null; trip_start: string | null;
  }>(
    `SELECT d.rel_path, p.display_name AS person_name, t.name AS trip_name,
            to_char(t.start_date, 'YYYY-MM-DD') AS trip_start
     FROM documents d
     LEFT JOIN people p ON p.id = d.owner_person_id
     LEFT JOIN trips t ON t.id = d.owner_trip_id
     WHERE d.id = $1`,
    [docId],
  );
  const d = rows[0];
  if (!d || !d.rel_path) return; // nothing to move
  const dir = documentDirFor(
    d.trip_name ? { tripName: d.trip_name, tripStart: d.trip_start } : null,
    d.person_name ? { personName: d.person_name } : null,
  );
  const currentDir = d.rel_path.slice(0, d.rel_path.lastIndexOf("/"));
  if (currentDir === dir) return;
  const newRel = await moveStored(d.rel_path, dir);
  await client.query("UPDATE documents SET rel_path = $1 WHERE id = $2", [newRel, docId]);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/lib/reconcile.doc.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/reconcile.ts backend/src/lib/reconcile.doc.test.ts
git commit -m "feat(reconcile): reconcileDocument (owner-change file move)"
```

---

## Task 4: Create + get document

**Files:**
- Create: `backend/src/routes/documents.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/routes/documents.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/documents.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates a fileless document (JSON) and reads it back with status", async () => {
  const person = await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1,'Dad') RETURNING id", [ctx.familyId]);
  const create = await ctx.app.inject({
    method: "POST", url: "/api/documents", headers: auth(),
    payload: { title: "Dad's Passport", docType: "passport", ownerPersonId: person.rows[0].id, expiresOn: "2031-04-11", reminderLeadDays: 90 },
  });
  expect(create.statusCode).toBe(201);
  const dto = create.json();
  expect(dto).toMatchObject({ title: "Dad's Passport", docType: "passport", ownerPersonName: "Dad", fileUrl: null, status: "ok" });

  const get = await ctx.app.inject({ method: "GET", url: `/api/documents/${dto.id}`, headers: auth() });
  expect(get.json().reminderLeadDays).toBe(90);
});

test("rejects an owner that isn't the family's", async () => {
  const res = await ctx.app.inject({
    method: "POST", url: "/api/documents", headers: auth(),
    payload: { title: "X", docType: "other", ownerPersonId: "11111111-1111-1111-1111-111111111111" },
  });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/documents.test.ts`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement `documents.ts` (create + get + shared loader)**

Create `backend/src/routes/documents.ts`:
```ts
import { Readable } from "node:stream";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { signFileUrl } from "../lib/filesign.js";
import { documentDirFor, saveDocumentUpload } from "../lib/storage.js";

interface DocRow {
  id: string; title: string; doc_type: string;
  owner_person_id: string | null; owner_trip_id: string | null;
  owner_person_name: string | null; owner_trip_name: string | null;
  issued_on: string | null; expires_on: string | null; reminder_lead_days: number;
  notes: string; rel_path: string | null; original_name: string; created_at: string;
  status: string; days_until: number | null;
}

function toDto(r: DocRow) {
  return {
    id: r.id, title: r.title, docType: r.doc_type,
    ownerPersonId: r.owner_person_id, ownerPersonName: r.owner_person_name,
    ownerTripId: r.owner_trip_id, ownerTripName: r.owner_trip_name,
    issuedOn: r.issued_on, expiresOn: r.expires_on, reminderLeadDays: r.reminder_lead_days,
    notes: r.notes, fileUrl: r.rel_path ? signFileUrl(r.rel_path) : null, originalName: r.original_name,
    createdAt: r.created_at, status: r.status, daysUntilExpiry: r.days_until,
  };
}

// The shared SELECT with owner joins + computed status. Append a WHERE.
const SELECT = `
  SELECT d.id, d.title, d.doc_type, d.owner_person_id, d.owner_trip_id,
         p.display_name AS owner_person_name, t.name AS owner_trip_name,
         to_char(d.issued_on,'YYYY-MM-DD') AS issued_on,
         to_char(d.expires_on,'YYYY-MM-DD') AS expires_on,
         d.reminder_lead_days, d.notes, d.rel_path, d.original_name, d.created_at,
         CASE WHEN d.expires_on IS NULL THEN 'none'
              WHEN d.expires_on < CURRENT_DATE THEN 'overdue'
              WHEN d.expires_on <= CURRENT_DATE + make_interval(days => d.reminder_lead_days) THEN 'upcoming'
              ELSE 'ok' END AS status,
         (d.expires_on - CURRENT_DATE) AS days_until
  FROM documents d
  LEFT JOIN people p ON p.id = d.owner_person_id
  LEFT JOIN trips t ON t.id = d.owner_trip_id`;

async function loadDoc(familyId: string, id: string): Promise<DocRow | null> {
  const { rows } = await query<DocRow>(`${SELECT} WHERE d.family_id = $1 AND d.id = $2`, [familyId, id]);
  return rows[0] ?? null;
}

const fieldsSchema = z.object({
  title: z.string().min(1).max(200),
  docType: z.enum(["passport", "visa", "booking", "insurance", "other"]),
  ownerPersonId: z.string().uuid().nullish(),
  ownerTripId: z.string().uuid().nullish(),
  issuedOn: z.string().nullish(),
  expiresOn: z.string().nullish(),
  reminderLeadDays: z.coerce.number().int().min(0).max(3650).optional(),
  notes: z.string().max(4000).optional(),
});

/** Validate the owner is one-of and belongs to the family; return its storage dir. */
async function ownerDir(familyId: string, personId?: string | null, tripId?: string | null):
  Promise<{ ok: true; dir: string } | { ok: false; error: string }> {
  if (personId && tripId) return { ok: false, error: "A document has at most one owner" };
  if (personId) {
    const p = await query<{ display_name: string }>("SELECT display_name FROM people WHERE id = $1 AND family_id = $2", [personId, familyId]);
    if (!p.rows[0]) return { ok: false, error: "Person not found" };
    return { ok: true, dir: documentDirFor(null, { personName: p.rows[0].display_name }) };
  }
  if (tripId) {
    const t = await query<{ name: string; start: string | null }>("SELECT name, to_char(start_date,'YYYY-MM-DD') AS start FROM trips WHERE id = $1 AND family_id = $2", [tripId, familyId]);
    if (!t.rows[0]) return { ok: false, error: "Trip not found" };
    return { ok: true, dir: documentDirFor({ tripName: t.rows[0].name, tripStart: t.rows[0].start }, null) };
  }
  return { ok: true, dir: documentDirFor(null, null) };
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/documents", async (req, reply) => {
    // Accept either JSON (no file) or multipart (with file). Collect fields + optional file.
    let body: Record<string, string> = {};
    let saved: { relPath: string; originalName: string } | null = null;
    let pendingFile: { filename: string; buf: Buffer } | null = null;

    if (req.isMultipart()) {
      // Buffer the file in-loop (consuming its stream) while collecting fields —
      // a deferred read would hang/destroy the part once the iterator advances.
      for await (const part of req.parts()) {
        if (part.type === "file") pendingFile = { filename: part.filename, buf: await part.toBuffer() };
        else if (typeof part.value === "string") body[part.fieldname] = part.value;
      }
    } else {
      body = (req.body ?? {}) as Record<string, string>;
    }

    const parsed = fieldsSchema.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const dir = await ownerDir(req.user.familyId, b.ownerPersonId, b.ownerTripId);
    if (!dir.ok) return reply.code(dir.error.includes("one owner") ? 400 : 404).send({ error: dir.error });

    if (pendingFile) {
      try {
        saved = await saveDocumentUpload({ filename: pendingFile.filename, file: Readable.from(pendingFile.buf) }, dir.dir);
      } catch {
        return reply.code(400).send({ error: "Unsupported file type" });
      }
    }

    const ins = await query<{ id: string }>(
      `INSERT INTO documents (family_id, title, doc_type, owner_person_id, owner_trip_id,
        issued_on, expires_on, reminder_lead_days, notes, rel_path, original_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [req.user.familyId, b.title, b.docType, b.ownerPersonId ?? null, b.ownerTripId ?? null,
       b.issuedOn || null, b.expiresOn || null, b.reminderLeadDays ?? 30, b.notes ?? "",
       saved?.relPath ?? null, saved?.originalName ?? "", req.user.id],
    );
    const row = await loadDoc(req.user.familyId, ins.rows[0].id);
    return reply.code(201).send(toDto(row!));
  });

  app.get("/api/documents/:id", async (req, reply) => {
    const row = await loadDoc(req.user.familyId, (req.params as { id: string }).id);
    if (!row) return reply.code(404).send({ error: "Not found" });
    return toDto(row);
  });
}
```

> The shared `loadDoc`/`SELECT`/`ownerDir`/`fieldsSchema`/`toDto` are reused by Tasks 5–6.

- [ ] **Step 4: Register the route**

In `backend/src/index.ts`, add `import { documentRoutes } from "./routes/documents.js";` and `await app.register(documentRoutes);`. Also register `@fastify/multipart` is already global — `req.isMultipart()`/`req.parts()` work.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/documents.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/documents.ts backend/src/routes/documents.test.ts backend/src/index.ts
git commit -m "feat(documents): create + get (optional file, owner validation, status)"
```

---

## Task 5: List + due-count

**Files:**
- Modify: `backend/src/routes/documents.ts`
- Test: `backend/src/routes/documents-list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/documents-list.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await buildTestApp();
  // overdue, upcoming (within 90d lead), far-future ok, and one without expiry.
  await query("INSERT INTO documents (family_id, title, doc_type, expires_on, reminder_lead_days) VALUES ($1,'Old Visa','visa', CURRENT_DATE - 5, 30)", [ctx.familyId]);
  await query("INSERT INTO documents (family_id, title, doc_type, expires_on, reminder_lead_days) VALUES ($1,'Passport','passport', CURRENT_DATE + 30, 90)", [ctx.familyId]);
  await query("INSERT INTO documents (family_id, title, doc_type, expires_on, reminder_lead_days) VALUES ($1,'Future','insurance', CURRENT_DATE + 800, 30)", [ctx.familyId]);
  await query("INSERT INTO documents (family_id, title, doc_type) VALUES ($1,'Booking','booking')", [ctx.familyId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("lists all documents", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/documents", headers: auth() });
  expect(res.json()).toHaveLength(4);
});

test("filters by docType and by due", async () => {
  const byType = await ctx.app.inject({ method: "GET", url: "/api/documents?docType=passport", headers: auth() });
  expect(byType.json()).toHaveLength(1);
  const due = await ctx.app.inject({ method: "GET", url: "/api/documents?due=1", headers: auth() });
  // overdue 'Old Visa' + upcoming 'Passport' (30 ≤ 90 lead); not Future, not Booking
  expect(due.json().map((d: any) => d.title).sort()).toEqual(["Old Visa", "Passport"]);
});

test("due-count returns the overdue+upcoming total", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/documents/due-count", headers: auth() });
  expect(res.json()).toEqual({ count: 2 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/documents-list.test.ts`
Expected: FAIL (routes missing).

- [ ] **Step 3: Add list + due-count to `documents.ts`**

Add inside `documentRoutes`, before the `GET /api/documents/:id` handler (so the static `/due-count` and the list register before the param route):
```ts
  app.get("/api/documents/due-count", async (req) => {
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM documents
       WHERE family_id = $1 AND expires_on IS NOT NULL
         AND expires_on <= CURRENT_DATE + make_interval(days => reminder_lead_days)`,
      [req.user.familyId]);
    return { count: Number(rows[0].count) };
  });

  app.get("/api/documents", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = ["d.family_id = $1"];
    const params: unknown[] = [req.user.familyId];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

    if (q.docType) where.push(`d.doc_type = ${add(q.docType)}`);
    if (q.q) where.push(`d.title ILIKE ${add(`%${q.q}%`)}`);
    if (q.owner) {
      const [kind, id] = q.owner.split(":");
      if (kind === "person" && id) where.push(`d.owner_person_id = ${add(id)}`);
      else if (kind === "trip" && id) where.push(`d.owner_trip_id = ${add(id)}`);
    }
    if (q.due === "1") where.push(`d.expires_on IS NOT NULL AND d.expires_on <= CURRENT_DATE + make_interval(days => d.reminder_lead_days)`);

    const { rows } = await query<DocRow>(
      `${SELECT} WHERE ${where.join(" AND ")} ORDER BY d.expires_on ASC NULLS LAST, d.created_at DESC`,
      params);
    return rows.map(toDto);
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/documents-list.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/documents.ts backend/src/routes/documents-list.test.ts
git commit -m "feat(documents): list (filters/status) + due-count"
```

---

## Task 6: Update + attach-file + delete

**Files:**
- Modify: `backend/src/routes/documents.ts`
- Test: `backend/src/routes/documents-mutate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/documents-mutate.test.ts`:
```ts
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { absStoragePath } from "../lib/storage.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("patch updates fields and moves the file when the owner changes", async () => {
  const person = await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1,'Dad') RETURNING id", [ctx.familyId]);
  const doc = await query<{ id: string }>(
    `INSERT INTO documents (family_id, title, doc_type, rel_path, original_name)
     VALUES ($1,'Passport','passport','loose/documents/p.pdf','p.pdf') RETURNING id`, [ctx.familyId]);
  const abs = absStoragePath("loose/documents/p.pdf");
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, "%PDF");

  const res = await ctx.app.inject({
    method: "PATCH", url: `/api/documents/${doc.rows[0].id}`, headers: auth(),
    payload: { notes: "renew early", ownerPersonId: person.rows[0].id },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().notes).toBe("renew early");
  const row = await query<{ rel_path: string }>("SELECT rel_path FROM documents WHERE id = $1", [doc.rows[0].id]);
  expect(row.rows[0].rel_path).toBe("people/dad/p.pdf");
  expect(existsSync(absStoragePath("people/dad/p.pdf"))).toBe(true);
});

test("deletes a document", async () => {
  const doc = await query<{ id: string }>("INSERT INTO documents (family_id, title, doc_type) VALUES ($1,'X','other') RETURNING id", [ctx.familyId]);
  const res = await ctx.app.inject({ method: "DELETE", url: `/api/documents/${doc.rows[0].id}`, headers: auth() });
  expect(res.statusCode).toBe(204);
  const row = await query("SELECT 1 FROM documents WHERE id = $1", [doc.rows[0].id]);
  expect(row.rowCount).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- src/routes/documents-mutate.test.ts`
Expected: FAIL (routes missing).

- [ ] **Step 3: Add patch + attach-file + delete to `documents.ts`**

Extend the imports and add handlers. At the top, extend the storage/reconcile/tx imports:
```ts
import { query, tx } from "../db/pool.js";
import { documentDirFor, saveDocumentUpload, deleteStored } from "../lib/storage.js";
import { reconcileDocument } from "../lib/reconcile.js";
```
Add inside `documentRoutes`:
```ts
  const patchSchema = fieldsSchema.partial();

  app.patch("/api/documents/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const existing = await loadDoc(req.user.familyId, id);
    if (!existing) return reply.code(404).send({ error: "Not found" });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);

    // Validate owner if either owner field is being set.
    if (has("ownerPersonId") || has("ownerTripId")) {
      const od = await ownerDir(req.user.familyId, b.ownerPersonId ?? null, b.ownerTripId ?? null);
      if (!od.ok) return reply.code(od.error.includes("one owner") ? 400 : 404).send({ error: od.error });
    }

    await tx(async (client) => {
      await client.query(
        `UPDATE documents SET
           title = COALESCE($3, title), doc_type = COALESCE($4, doc_type),
           owner_person_id = CASE WHEN $5::boolean THEN $6 ELSE owner_person_id END,
           owner_trip_id  = CASE WHEN $7::boolean THEN $8 ELSE owner_trip_id END,
           issued_on  = CASE WHEN $9::boolean THEN $10 ELSE issued_on END,
           expires_on = CASE WHEN $11::boolean THEN $12 ELSE expires_on END,
           reminder_lead_days = COALESCE($13, reminder_lead_days),
           notes = COALESCE($14, notes)
         WHERE id = $1 AND family_id = $2`,
        [id, req.user.familyId, b.title ?? null, b.docType ?? null,
         has("ownerPersonId"), b.ownerPersonId ?? null, has("ownerTripId"), b.ownerTripId ?? null,
         has("issuedOn"), b.issuedOn || null, has("expiresOn"), b.expiresOn || null,
         b.reminderLeadDays ?? null, b.notes ?? null]);
      if (has("ownerPersonId") || has("ownerTripId")) await reconcileDocument(client, id);
    });
    const row = await loadDoc(req.user.familyId, id);
    return toDto(row!);
  });

  app.post("/api/documents/:id/file", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const existing = await loadDoc(req.user.familyId, id);
    if (!existing) return reply.code(404).send({ error: "Not found" });
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: "No file provided" });
    const od = await ownerDir(req.user.familyId, existing.owner_person_id, existing.owner_trip_id);
    if (!od.ok) return reply.code(400).send({ error: od.error });
    let saved: { relPath: string; originalName: string };
    try {
      saved = await saveDocumentUpload(part, od.dir);
    } catch {
      return reply.code(400).send({ error: "Unsupported file type" });
    }
    if (existing.rel_path) await deleteStored(existing.rel_path);
    await query("UPDATE documents SET rel_path = $1, original_name = $2 WHERE id = $3", [saved.relPath, saved.originalName, id]);
    const row = await loadDoc(req.user.familyId, id);
    return toDto(row!);
  });

  app.delete("/api/documents/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const existing = await loadDoc(req.user.familyId, id);
    if (!existing) return reply.code(404).send({ error: "Not found" });
    await query("DELETE FROM documents WHERE id = $1", [id]);
    if (existing.rel_path) await deleteStored(existing.rel_path);
    return reply.code(204).send();
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test -- src/routes/documents-mutate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/documents.ts backend/src/routes/documents-mutate.test.ts
git commit -m "feat(documents): patch (+reconcile), attach-file, delete"
```

---

## Task 7: Full backend verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck**

Run: `cd backend && npm test && npm run typecheck`
Expected: all test files PASS; typecheck clean.

- [ ] **Step 2: Commit (if any incidental fixes)**

```bash
git add -A backend
git commit -m "chore: phase 5A documents backend verified" || echo "nothing to commit"
```

---

## Notes for Plan 5B (frontend)

- `GET /api/documents?docType=&owner=person:<id>|trip:<id>&q=&due=1` → `Document[]`, each: `{ id, title, docType, ownerPersonId, ownerPersonName, ownerTripId, ownerTripName, issuedOn, expiresOn, reminderLeadDays, notes, fileUrl, originalName, createdAt, status: "overdue"|"upcoming"|"ok"|"none", daysUntilExpiry }`.
- `GET /api/documents/due-count` → `{ count }` (rail badge).
- `POST /api/documents` — JSON (no file) or multipart (with `file`) + the fields above.
- `PATCH /api/documents/:id` (JSON), `POST /api/documents/:id/file` (multipart), `DELETE /api/documents/:id`.
