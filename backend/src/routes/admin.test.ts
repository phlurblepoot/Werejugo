import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { config } from "../config.js";

let ctx: TestCtx; // ctx.token = server admin
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

const req = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, token: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });

test("only admins reach the admin API", async () => {
  const owner = await addUser(ctx, { familyName: "Regulars", role: "owner" });
  expect((await req("GET", "/api/admin/overview", owner.token)).statusCode).toBe(403);
  expect((await req("GET", "/api/admin/overview", ctx.token)).statusCode).toBe(200);
});

test("the overview lists every family with its owners and size", async () => {
  const smith = await addUser(ctx, { familyName: "The Smiths", role: "owner" });
  await addUser(ctx, { familyId: smith.familyId, role: "member" });
  const o = (await req("GET", "/api/admin/overview", ctx.token)).json();
  const row = o.families.find((f: { name: string }) => f.name === "The Smiths");
  expect(row).toMatchObject({ memberCount: 2, disabled: false });
  expect(row.owners.length).toBe(1);
});

test("disabling a family locks its members out until re-enabled", async () => {
  const fam = await addUser(ctx, { familyName: "Snoozers", role: "owner" });
  expect((await req("PATCH", `/api/admin/families/${fam.familyId}`, ctx.token, { disabled: true })).statusCode).toBe(200);
  expect((await req("GET", "/api/trips", fam.token)).statusCode).toBe(403);
  await req("PATCH", `/api/admin/families/${fam.familyId}`, ctx.token, { disabled: false });
  expect((await req("GET", "/api/trips", fam.token)).statusCode).toBe(200);
});

test("deleting a family needs its exact name, removes its data and files, and never your own", async () => {
  const fam = await addUser(ctx, { familyName: "Leaving Co", role: "owner" });
  await mkdir(join(config.storageDir, "loose", "2020"), { recursive: true });
  await writeFile(join(config.storageDir, "loose", "2020", "gone.pdf"), "x");
  await query("INSERT INTO documents (family_id, title, doc_type, rel_path) VALUES ($1, 'Passport', 'passport', 'loose/2020/gone.pdf')", [fam.familyId]);
  // Its photos are references to its Immich account: the rows go, Immich keeps the photos.
  await query("INSERT INTO media (family_id, kind, immich_asset_id) VALUES ($1, 'image', gen_random_uuid())", [fam.familyId]);

  expect((await req("DELETE", `/api/admin/families/${fam.familyId}`, ctx.token, { confirmName: "leaving co" })).statusCode).toBe(400);
  expect((await req("DELETE", `/api/admin/families/${ctx.familyId}`, ctx.token, { confirmName: "Test Family" })).statusCode).toBe(400);
  expect((await req("DELETE", `/api/admin/families/${fam.familyId}`, ctx.token, { confirmName: "Leaving Co" })).statusCode).toBe(204);
  expect((await query("SELECT 1 FROM families WHERE id = $1", [fam.familyId])).rowCount).toBe(0);
  expect(existsSync(join(config.storageDir, "loose", "2020", "gone.pdf"))).toBe(false);
  expect((await query("SELECT 1 FROM media WHERE family_id = $1", [fam.familyId])).rowCount).toBe(0);
});

test("users: search, make admin, disable — but never lose the last admin", async () => {
  const u = await addUser(ctx, { familyName: "Searchable", email: "findme@test.dev" });
  const found = (await req("GET", "/api/admin/users?q=findme", ctx.token)).json();
  expect(found.map((x: { email: string }) => x.email)).toEqual(["findme@test.dev"]);

  expect((await req("PATCH", `/api/admin/users/${ctx.userId}`, ctx.token, { isAdmin: false })).statusCode).toBe(400);
  expect((await req("PATCH", `/api/admin/users/${u.userId}`, ctx.token, { isAdmin: true })).statusCode).toBe(200);
  // with two admins, the first may step down (then re-promote to keep the rest of the suite valid)
  expect((await req("PATCH", `/api/admin/users/${ctx.userId}`, ctx.token, { isAdmin: false })).statusCode).toBe(200);
  await query("UPDATE users SET is_admin = true WHERE id = $1", [ctx.userId]);
  await query("UPDATE users SET token_version = 0 WHERE id = $1", [ctx.userId]);

  const victim = await addUser(ctx, { familyName: "Disabled Inc" });
  expect((await req("PATCH", `/api/admin/users/${victim.userId}`, ctx.token, { disabled: true })).statusCode).toBe(200);
  expect((await req("GET", "/api/trips", victim.token)).statusCode).toBe(401);
});

test("an admin can step into a family, is audited, and can step back out", async () => {
  const fam = await addUser(ctx, { familyName: "Visited", role: "owner" });
  await query("INSERT INTO trips (family_id, name) VALUES ($1, 'Their Trip')", [fam.familyId]);

  const view = await req("POST", "/api/admin/view-family", ctx.token, { familyId: fam.familyId });
  const viewToken = view.json().token;
  const trips = (await req("GET", "/api/trips", viewToken)).json();
  expect(trips.map((t: { name: string }) => t.name)).toEqual(["Their Trip"]);
  const me = (await req("GET", "/api/auth/me", viewToken)).json();
  expect(me.adminView).toMatchObject({ homeFamilyId: ctx.familyId });
  expect(me.family.name).toBe("Visited");

  const back = (await req("POST", "/api/admin/return", viewToken)).json().token;
  expect((await req("GET", "/api/auth/me", back)).json().adminView).toBeNull();

  const log = (await req("GET", "/api/admin/audit", ctx.token)).json();
  expect(log.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(["admin.view_family", "admin.return"]));
  expect(log[0].id > log[log.length - 1].id).toBe(true); // newest first
});
