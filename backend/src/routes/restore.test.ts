import { afterAll, beforeAll, expect, test } from "vitest";
import FormData from "form-data";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { config } from "../config.js";
import { writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as tar from "tar";

/** Build a .tar.gz from a map of relative path -> contents. */
async function makeArchive(files: Record<string, string>): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "mk-"));
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), body);
  }
  const out = join(dir, "..", `${dir.split("/").pop()}.tgz`);
  await tar.c({ gzip: true, file: out, cwd: dir }, Object.keys(files).map((f) => f.split("/")[0]).filter((v, i, a) => a.indexOf(v) === i));
  const buf = await readFile(out);
  await rm(dir, { recursive: true, force: true });
  await rm(out, { force: true });
  return buf;
}
const MANIFEST = JSON.stringify({ version: 2, app: "werejugo", tables: ["trips"] });

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await buildTestApp();
  await query("INSERT INTO trips (family_id, name, created_by) VALUES ($1,'Round Trip',$2)", [ctx.familyId, ctx.userId]);
  await mkdir(join(config.storageDir, "loose", "2024"), { recursive: true });
  await writeFile(join(config.storageDir, "loose", "2024", "keep.txt"), "original");
  await mkdir(config.uploadsDir, { recursive: true });
  await writeFile(join(config.uploadsDir, "overlay.png"), "overlay-original");
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
  await writeFile(join(config.storageDir, "stray.txt"), "should disappear");
  await writeFile(join(config.uploadsDir, "overlay.png"), "CLOBBERED");
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
  expect(existsSync(join(config.storageDir, "stray.txt"))).toBe(false);
  expect(await readFile(join(config.uploadsDir, "overlay.png"), "utf8")).toBe("overlay-original");
});

async function restore(archive: Buffer) {
  const form = new FormData();
  form.append("file", archive, { filename: "b.tar.gz", contentType: "application/gzip" });
  return ctx.app.inject({ method: "POST", url: "/api/restore", headers: { ...auth(), ...form.getHeaders() }, payload: form.getBuffer() });
}

test("an archive without a storage/ folder is rejected and nothing is touched", async () => {
  const before = (await query("SELECT 1 FROM trips")).rowCount;
  const res = await restore(await makeArchive({ "manifest.json": MANIFEST, "db.json": JSON.stringify({ trips: [] }) }));
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toMatch(/storage/);
  expect((await query("SELECT 1 FROM trips")).rowCount).toBe(before);
  expect(await readFile(join(config.storageDir, "loose", "2024", "keep.txt"), "utf8")).toBe("original");
});

test("an archive naming unknown tables is rejected and nothing is touched", async () => {
  const before = (await query("SELECT 1 FROM trips")).rowCount;
  const res = await restore(await makeArchive({
    "manifest.json": MANIFEST,
    "db.json": JSON.stringify({ trips: [], "pg_authid": [] }),
    "storage/x.txt": "x",
  }));
  expect(res.statusCode).toBe(400);
  expect((await query("SELECT 1 FROM trips")).rowCount).toBe(before);
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
