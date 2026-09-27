import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
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

test("only a server admin can download a backup", async () => {
  // a member of the admin's own family
  const member = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  expect((await ctx.app.inject({ method: "GET", url: "/api/backup", headers: bearer(member.token) })).statusCode).toBe(403);
  // the owner of another family
  const stranger = await addUser(ctx, { familyName: "Strangers", role: "owner" });
  expect((await ctx.app.inject({ method: "GET", url: "/api/backup", headers: bearer(stranger.token) })).statusCode).toBe(403);
});

test("downloading a backup is audited", async () => {
  const actions = (await query<{ action: string }>("SELECT action FROM audit_log")).rows.map((r) => r.action);
  expect(actions).toContain("backup.downloaded");
});
