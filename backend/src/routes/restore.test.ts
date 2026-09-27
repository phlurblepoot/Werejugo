import { afterAll, beforeAll, expect, test } from "vitest";
import FormData from "form-data";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { addUser, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
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

test("a non-admin cannot restore", async () => {
  const memberToken = (await addUser(ctx, { familyId: ctx.familyId, role: "owner" })).token;
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

// Keep last: it replaces every account, including the test admin.
test("a backup from an older version restores: missing columns get defaults, someone is admin", async () => {
  const famId = "11111111-1111-4111-8111-111111111111";
  const res = await restore(await makeArchive({
    "manifest.json": JSON.stringify({ version: 1, app: "werejugo", tables: ["families", "users"] }),
    "db.json": JSON.stringify({
      // pre-1.3 rows: families still have invite_code; users lack is_admin, token_version, …
      families: [{ id: famId, name: "Old Timers", invite_code: "OLD1", created_at: "2025-01-01T00:00:00Z", settings: {} }],
      // tables that no longer exist are skipped
      map_sets: [{ id: "33333333-3333-4333-8333-333333333333", family_id: famId, name: "Old map" }],
      map_set_visits: [],
      users: [{
        id: "22222222-2222-4222-8222-222222222222", family_id: famId, email: "old@test.dev", display_name: "Old",
        password_hash: "x", role: "owner", color: "#2563eb", created_at: "2025-01-01T00:00:00Z",
      }],
    }),
    "storage/.keep": "",
  }));
  expect(res.statusCode).toBe(200);
  expect(res.json().counts).not.toHaveProperty("map_sets");
  const u = (await query<{ is_admin: boolean; token_version: number }>("SELECT is_admin, token_version FROM users WHERE email = 'old@test.dev'")).rows[0];
  expect(u).toEqual({ is_admin: true, token_version: 0 });
});

test("every table is backed up, or left out for a stated reason", async () => {
  const { BACKUP_TABLES, NOT_BACKED_UP } = await import("../lib/archive.js");
  const tables = (await query<{ t: string }>("SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.t);
  const known = new Set<string>([...BACKUP_TABLES, ...Object.keys(NOT_BACKED_UP)]);
  expect(tables.filter((t) => !known.has(t))).toEqual([]);
});
