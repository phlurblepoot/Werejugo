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
