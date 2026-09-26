import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { config } from "../config.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await buildTestApp();
  await query("INSERT INTO trips (family_id, name, created_by) VALUES ($1,'Backup Trip',$2)", [ctx.familyId, ctx.userId]);
  await mkdir(join(config.storageDir, "loose", "2024"), { recursive: true });
  await writeFile(join(config.storageDir, "loose", "2024", "photo.txt"), "hello-bytes");
  await mkdir(config.uploadsDir, { recursive: true });
  await writeFile(join(config.uploadsDir, "pin-icon.png"), "icon-bytes");
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("backup is a gzip tar containing db.json, manifest.json and the storage tree", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/backup", headers: auth() });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("application/gzip");
  const buf = res.rawPayload;
  expect(buf[0]).toBe(0x1f); // gzip magic
  expect(buf[1]).toBe(0x8b);

  // extract and inspect
  const dir = await mkdtemp(join(tmpdir(), "bk-"));
  const tgz = join(dir, "b.tgz");
  await writeFile(tgz, buf);
  await tar.x({ file: tgz, cwd: dir });
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  expect(manifest.tables).toContain("trips");
  const db = JSON.parse(await readFile(join(dir, "db.json"), "utf8"));
  expect(db.trips.some((r: any) => r.name === "Backup Trip")).toBe(true);
  expect(await readFile(join(dir, "storage", "loose", "2024", "photo.txt"), "utf8")).toBe("hello-bytes");
  // custom pin icons / map overlays live in UPLOADS_DIR and must be backed up too
  expect(await readFile(join(dir, "uploads", "pin-icon.png"), "utf8")).toBe("icon-bytes");
  await rm(dir, { recursive: true, force: true });
});

test("requires auth", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/backup" });
  expect(res.statusCode).toBe(401);
});

test("only the server owner (the first family's owner) can download a backup", async () => {
  // a member of the first family
  const member = ctx.app.jwt.sign({ id: ctx.userId, familyId: ctx.familyId, role: "member" });
  expect((await ctx.app.inject({ method: "GET", url: "/api/backup", headers: { authorization: `Bearer ${member}` } })).statusCode).toBe(403);

  // the owner of a family created later — e.g. a stranger who signed up
  const fam2 = (await query<{ id: string }>("INSERT INTO families (name, invite_code) VALUES ('Strangers','STRANGE1') RETURNING id")).rows[0].id;
  const u2 = (await query<{ id: string }>(
    "INSERT INTO users (family_id, email, display_name, password_hash, role) VALUES ($1,'s@evil.test','S','x','owner') RETURNING id", [fam2])).rows[0].id;
  const stranger = ctx.app.jwt.sign({ id: u2, familyId: fam2, role: "owner" });
  expect((await ctx.app.inject({ method: "GET", url: "/api/backup", headers: { authorization: `Bearer ${stranger}` } })).statusCode).toBe(403);
});
