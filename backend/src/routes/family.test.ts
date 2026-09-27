import { afterAll, beforeAll, expect, test } from "vitest";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

const req = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, token: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });

test("everyone sees the members; only owners see pending invites", async () => {
  const member = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  await req("POST", "/api/family/invites", ctx.token, {});

  const asOwner = (await req("GET", "/api/family", ctx.token)).json();
  expect(asOwner.family.name).toBe("Test Family");
  expect(asOwner.members.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining([ctx.userId, member.userId]));
  expect(asOwner.invites.length).toBe(1);

  const asMember = (await req("GET", "/api/family", member.token)).json();
  expect(asMember.members.length).toBe(asOwner.members.length);
  expect(asMember.invites).toEqual([]);
});

test("only owners rename the family", async () => {
  const member = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  expect((await req("PATCH", "/api/family", member.token, { name: "Hijacked" })).statusCode).toBe(403);
  expect((await req("PATCH", "/api/family", ctx.token, { name: "The Travelers" })).statusCode).toBe(200);
});

test("promoting and demoting, but never below one owner", async () => {
  const fam = await addUser(ctx, { familyName: "Solo", role: "owner" });
  expect((await req("PATCH", `/api/family/members/${fam.userId}`, fam.token, { role: "member" })).statusCode).toBe(400);

  const kid = await addUser(ctx, { familyId: fam.familyId, role: "member" });
  expect((await req("PATCH", `/api/family/members/${kid.userId}`, fam.token, { role: "owner" })).statusCode).toBe(200);
  // now two owners, so the first may step down
  expect((await req("PATCH", `/api/family/members/${fam.userId}`, fam.token, { role: "member" })).statusCode).toBe(200);
});

test("removing members: not yourself, not the admin (unless you are one), not someone else's", async () => {
  const coOwner = await addUser(ctx, { familyId: ctx.familyId, role: "owner" });
  const leaving = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  expect((await req("DELETE", `/api/family/members/${coOwner.userId}`, coOwner.token)).statusCode).toBe(400);
  expect((await req("DELETE", `/api/family/members/${ctx.userId}`, coOwner.token)).statusCode).toBe(403);
  const outsider = await addUser(ctx, { familyName: "Nope" });
  expect((await req("DELETE", `/api/family/members/${outsider.userId}`, coOwner.token)).statusCode).toBe(404);

  expect((await req("DELETE", `/api/family/members/${leaving.userId}`, coOwner.token)).statusCode).toBe(204);
  expect((await query("SELECT 1 FROM users WHERE id = $1", [leaving.userId])).rowCount).toBe(0);
  expect((await req("GET", "/api/trips", leaving.token)).statusCode).toBe(401);
});

test("members can't manage other members", async () => {
  const member = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  const other = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  expect((await req("PATCH", `/api/family/members/${other.userId}`, member.token, { role: "owner" })).statusCode).toBe(403);
  expect((await req("DELETE", `/api/family/members/${other.userId}`, member.token)).statusCode).toBe(403);
  expect((await req("POST", `/api/family/members/${other.userId}/reset-link`, member.token)).statusCode).toBe(403);
});
