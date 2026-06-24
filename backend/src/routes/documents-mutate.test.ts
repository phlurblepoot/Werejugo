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
