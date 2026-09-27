import { afterAll, beforeAll, expect, test } from "vitest";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

// requireAuth checks the account behind every token, not just the signature.

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

const get = (url: string, token: string) => ctx.app.inject({ method: "GET", url, headers: bearer(token) });
const patchFamily = (token: string) =>
  ctx.app.inject({ method: "PATCH", url: "/api/family", headers: bearer(token), payload: { name: "Renamed" } });

test("a revoked token (token_version bumped) stops working", async () => {
  const u = await addUser(ctx, { familyId: ctx.familyId });
  expect((await get("/api/trips", u.token)).statusCode).toBe(200);
  await query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [u.userId]);
  expect((await get("/api/trips", u.token)).statusCode).toBe(401);
});

test("a disabled user's token stops working", async () => {
  const u = await addUser(ctx, { familyId: ctx.familyId });
  await query("UPDATE users SET disabled_at = now() WHERE id = $1", [u.userId]);
  expect((await get("/api/trips", u.token)).statusCode).toBe(401);
});

test("the role comes from the database, not the token", async () => {
  const u = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  expect((await patchFamily(u.token)).statusCode).toBe(403);
  // promoted in the database → the same token now has owner rights
  await query("UPDATE users SET role = 'owner' WHERE id = $1", [u.userId]);
  expect((await patchFamily(u.token)).statusCode).toBe(200);
  // a token that *claims* owner doesn't help a member
  const m = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  const forged = ctx.app.jwt.sign({ id: m.userId, familyId: ctx.familyId, role: "owner", tv: 0 });
  expect((await patchFamily(forged)).statusCode).toBe(403);
});

test("a token naming a family the user isn't in is refused", async () => {
  const other = await addUser(ctx, { familyName: "Elsewhere", role: "owner" });
  const u = await addUser(ctx, { familyId: ctx.familyId });
  const forged = ctx.app.jwt.sign({ id: u.userId, familyId: other.familyId, role: "member", tv: 0 });
  expect((await get("/api/trips", forged)).statusCode).toBe(401);
});

test("a disabled family is locked out, but the admin still gets in", async () => {
  const fam = await addUser(ctx, { familyName: "Paused", role: "owner" });
  await query("UPDATE families SET disabled_at = now() WHERE id = $1", [fam.familyId]);
  expect((await get("/api/trips", fam.token)).statusCode).toBe(403);
  const adminThere = await addUser(ctx, { familyId: fam.familyId, role: "owner", isAdmin: true });
  expect((await get("/api/trips", adminThere.token)).statusCode).toBe(200);
});

test("an 'admin view' token only works for an actual admin", async () => {
  const other = await addUser(ctx, { familyName: "Neighbours", role: "owner" });
  const u = await addUser(ctx, { familyId: ctx.familyId, role: "owner" });
  const forged = ctx.app.jwt.sign({ id: u.userId, familyId: other.familyId, role: "owner", tv: 0, adminView: { homeFamilyId: ctx.familyId } });
  expect((await get("/api/trips", forged)).statusCode).toBe(401);
});
