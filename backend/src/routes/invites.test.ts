import { afterAll, beforeAll, expect, test } from "vitest";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx; // ctx.token = the server admin (owner of "Test Family")
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

const post = (url: string, token: string | null, payload: object = {}) =>
  ctx.app.inject({ method: "POST", url, headers: token ? bearer(token) : {}, payload });
const tokenOf = (path: string) => path.split("/").pop()!;
const newcomer = (email: string) => ({ email, displayName: "New Person", password: "password123" });

test("the admin invites a new family; the link creates it once", async () => {
  const link = (await post("/api/admin/family-invites", ctx.token, { note: "The Smiths" })).json();
  expect(link.path).toMatch(/^\/invite\/[\w-]{40,}$/);
  const t = tokenOf(link.path);

  const preview = await ctx.app.inject({ method: "GET", url: `/api/invites/${t}` });
  expect(preview.json()).toMatchObject({ kind: "family", adminName: "Owner" });

  const res = await post(`/api/invites/${t}/accept`, null, { ...newcomer("smith@test.dev"), familyName: "The Smiths" });
  expect(res.statusCode).toBe(200);
  expect(res.json().user).toMatchObject({ role: "owner", isAdmin: false });
  const me = (await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(res.json().token) })).json();
  expect(me.family.name).toBe("The Smiths");

  expect((await post(`/api/invites/${t}/accept`, null, { ...newcomer("again@test.dev"), familyName: "Again" })).statusCode).toBe(404);
  expect((await ctx.app.inject({ method: "GET", url: `/api/invites/${t}` })).statusCode).toBe(404);
  const actions = (await query<{ action: string }>("SELECT action FROM audit_log")).rows.map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining(["invite.family_created_link", "invite.family_created"]));
});

test("a family owner invites a member with a chosen role", async () => {
  const link = (await post("/api/family/invites", ctx.token, { role: "member" })).json();
  const preview = (await ctx.app.inject({ method: "GET", url: `/api/invites/${tokenOf(link.path)}` })).json();
  expect(preview).toMatchObject({ kind: "member", familyName: "Test Family", role: "member" });
  const res = await post(`/api/invites/${tokenOf(link.path)}/accept`, null, newcomer("kid@test.dev"));
  expect(res.json().user).toMatchObject({ role: "member", familyId: ctx.familyId });

  // They're signed in now, and don't share a colour with anyone already in the family.
  const family = (await ctx.app.inject({ method: "GET", url: "/api/family", headers: bearer(ctx.token) })).json();
  const kid = family.members.find((m: { email: string }) => m.email === "kid@test.dev");
  expect(kid.lastLoginAt).not.toBeNull();
  const others = family.members.filter((m: { email: string }) => m.email !== "kid@test.dev").map((m: { color: string }) => m.color);
  expect(others).not.toContain(kid.color);
});

test("members can't invite; non-admins can't invite families", async () => {
  const member = await addUser(ctx, { familyId: ctx.familyId, role: "member" });
  expect((await post("/api/family/invites", member.token)).statusCode).toBe(403);
  const owner = await addUser(ctx, { familyName: "Other", role: "owner" });
  expect((await post("/api/admin/family-invites", owner.token)).statusCode).toBe(403);
});

test("expired and revoked invites can't be used", async () => {
  const expired = (await post("/api/family/invites", ctx.token)).json();
  await query("UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = $1", [expired.id]);
  expect((await post(`/api/invites/${tokenOf(expired.path)}/accept`, null, newcomer("late@test.dev"))).statusCode).toBe(404);

  const revoked = (await post("/api/family/invites", ctx.token)).json();
  expect((await ctx.app.inject({ method: "DELETE", url: `/api/family/invites/${revoked.id}`, headers: bearer(ctx.token) })).statusCode).toBe(204);
  expect((await post(`/api/invites/${tokenOf(revoked.path)}/accept`, null, newcomer("nope@test.dev"))).statusCode).toBe(404);
});

test("a taken email is refused and the invite stays usable", async () => {
  const link = (await post("/api/family/invites", ctx.token)).json();
  const t = tokenOf(link.path);
  expect((await post(`/api/invites/${t}/accept`, null, newcomer("owner@test.dev"))).statusCode).toBe(409);
  expect((await post(`/api/invites/${t}/accept`, null, newcomer("fresh@test.dev"))).statusCode).toBe(200);
});

test("an unknown token reveals nothing", async () => {
  expect((await ctx.app.inject({ method: "GET", url: "/api/invites/not-a-real-token" })).statusCode).toBe(404);
});
