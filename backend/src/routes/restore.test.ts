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
