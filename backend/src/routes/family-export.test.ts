import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx, type TestUser } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { config } from "../config.js";

let ctx: TestCtx;
let other: TestUser;
beforeAll(async () => {
  ctx = await buildTestApp();
  other = await addUser(ctx, { familyName: "Neighbours", role: "owner" });
  const trip = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1, 'Lisbon') RETURNING id", [ctx.familyId])).rows[0].id;
  await query("INSERT INTO visits (family_id, trip_id, title, geom) VALUES ($1, $2, 'Belem', ST_SetSRID(ST_MakePoint(-9.2, 38.7), 4326))", [ctx.familyId, trip]);
  await query("INSERT INTO trips (family_id, name) VALUES ($1, 'Their Secret Trip')", [other.familyId]);
  await mkdir(join(config.storageDir, "trips", "lisbon"), { recursive: true });
  await writeFile(join(config.storageDir, "trips", "lisbon", "tram-tickets.pdf"), "pdf-bytes");
  await query("INSERT INTO documents (family_id, title, doc_type, rel_path) VALUES ($1, 'Tram tickets', 'booking', 'trips/lisbon/tram-tickets.pdf')", [ctx.familyId]);
  await writeFile(join(config.storageDir, "theirs.pdf"), "not yours");
  await query("INSERT INTO documents (family_id, title, doc_type, rel_path) VALUES ($1, 'Theirs', 'other', 'theirs.pdf')", [other.familyId]);
  // a path that tries to escape the storage folder is never followed
  await query("INSERT INTO documents (family_id, title, doc_type, rel_path) VALUES ($1, 'Escape', 'other', '../../etc/passwd')", [ctx.familyId]);
  // Photos are references to the family's Immich account.
  await query("INSERT INTO media (family_id, kind, immich_asset_id, original_name) VALUES ($1, 'image', gen_random_uuid(), 'tram.jpg')", [ctx.familyId]);
  await mkdir(join(config.uploadsDir, "icons"), { recursive: true });
  await writeFile(join(config.uploadsDir, "icons", "boat.png"), "png");
  await query("INSERT INTO icons (family_id, name, url) VALUES ($1, 'Boat', '/uploads/icons/boat.png')", [ctx.familyId]);
});
afterAll(() => closeTestApp(ctx));

async function unpack(payload: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fx-"));
  await writeFile(join(dir, "a.tgz"), payload);
  await tar.x({ file: join(dir, "a.tgz"), cwd: dir });
  return dir;
}

test("owners download their family's rows and files — nothing else, no secrets", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/family/export", headers: bearer(ctx.token) });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-disposition"]).toMatch(/werejugo-test-family-\d{4}-\d{2}-\d{2}\.tar\.gz/);
  const dir = await unpack(res.rawPayload);
  try {
    const doc = JSON.parse(await readFile(join(dir, "family.json"), "utf8"));
    expect(doc.family).toBe("Test Family");
    expect(doc.data.trips.map((t: { name: string }) => t.name)).toEqual(["Lisbon"]);
    expect(doc.data.visits[0].geom.type).toBe("Point");
    const text = JSON.stringify(doc);
    expect(text).not.toContain("Their Secret Trip");
    expect(text).not.toContain("password_hash");
    expect(text).not.toContain("token_version");
    expect(doc.missingFiles).toEqual(["storage/../../etc/passwd"]);
    expect(await readFile(join(dir, "files", "storage", "trips", "lisbon", "tram-tickets.pdf"), "utf8")).toBe("pdf-bytes");
    // Photos: listed, and the archive says where the files are.
    expect(doc.data.media.map((m: { original_name: string }) => m.original_name)).toEqual(["tram.jpg"]);
    expect(doc.data.media[0].immich_asset_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(doc.photos).toMatch(/Immich account/);
    expect(await readFile(join(dir, "files", "uploads", "icons", "boat.png"), "utf8")).toBe("png");
    expect(await readdir(join(dir, "files", "storage"))).toEqual(["trips"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const logged = await query("SELECT 1 FROM audit_log WHERE action = 'family.exported' AND family_id = $1", [ctx.familyId]);
  expect(logged.rowCount).toBe(1);
});

test("members can't export", async () => {
  const member = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  expect((await ctx.app.inject({ method: "GET", url: "/api/family/export", headers: bearer(member.token) })).statusCode).toBe(403);
});

test("the browser can fetch it by a short-lived link that is good for nothing else", async () => {
  const t = await ctx.app.inject({ method: "POST", url: "/api/downloads/ticket", headers: bearer(ctx.token), payload: { purpose: "family-export" } });
  const url: string = t.json().url;
  expect(url).toMatch(/^\/api\/family\/export\?ticket=/);
  expect((await ctx.app.inject({ method: "GET", url })).statusCode).toBe(200);

  const ticket = decodeURIComponent(url.split("ticket=")[1]);
  // not a login…
  expect((await ctx.app.inject({ method: "GET", url: "/api/trips", headers: bearer(ticket) })).statusCode).toBe(401);
  // …and not a ticket for anything else
  expect((await ctx.app.inject({ method: "GET", url: `/api/backup?ticket=${encodeURIComponent(ticket)}` })).statusCode).toBe(401);
  // members can't get one, and only admins get backup tickets
  const member = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  expect((await ctx.app.inject({ method: "POST", url: "/api/downloads/ticket", headers: bearer(member.token), payload: { purpose: "family-export" } })).statusCode).toBe(403);
  expect((await ctx.app.inject({ method: "POST", url: "/api/downloads/ticket", headers: bearer(other.token), payload: { purpose: "backup" } })).statusCode).toBe(403);
  // signing out everywhere kills outstanding tickets too
  await ctx.app.inject({ method: "POST", url: "/api/account/sign-out-everywhere", headers: bearer(ctx.token) });
  expect((await ctx.app.inject({ method: "GET", url })).statusCode).toBe(401);
});
