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
  await rm(dir, { recursive: true, force: true });
});

test("requires auth", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/backup" });
  expect(res.statusCode).toBe(401);
});
