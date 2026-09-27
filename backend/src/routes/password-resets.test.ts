import { afterAll, beforeAll, expect, test } from "vitest";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

const tokenOf = (path: string) => path.split("/").pop()!;

test("an owner makes a reset link; it sets a new password once and signs out old sessions", async () => {
  const m = await addUser(ctx, { familyId: ctx.familyId, email: "forgetful@test.dev", password: "old-password" });
  const link = (await ctx.app.inject({ method: "POST", url: `/api/family/members/${m.userId}/reset-link`, headers: bearer(ctx.token) })).json();
  const t = tokenOf(link.path);

  expect((await ctx.app.inject({ method: "GET", url: `/api/password-resets/${t}` })).json()).toMatchObject({ email: "forgetful@test.dev" });
  expect((await ctx.app.inject({ method: "POST", url: `/api/password-resets/${t}`, payload: { password: "brand-new-pw" } })).statusCode).toBe(200);

  const login = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "forgetful@test.dev", password: "brand-new-pw" } });
  expect(login.statusCode).toBe(200);
  expect((await ctx.app.inject({ method: "GET", url: "/api/trips", headers: bearer(m.token) })).statusCode).toBe(401);
  expect((await ctx.app.inject({ method: "POST", url: `/api/password-resets/${t}`, payload: { password: "another-pw-1" } })).statusCode).toBe(404);
});

test("an owner can't reset the server admin's password", async () => {
  const coOwner = await addUser(ctx, { familyId: ctx.familyId, role: "owner" });
  const res = await ctx.app.inject({ method: "POST", url: `/api/family/members/${ctx.userId}/reset-link`, headers: bearer(coOwner.token) });
  expect(res.statusCode).toBe(403);
});

test("an owner can't reset someone in another family", async () => {
  const outsider = await addUser(ctx, { familyName: "Elsewhere" });
  const res = await ctx.app.inject({ method: "POST", url: `/api/family/members/${outsider.userId}/reset-link`, headers: bearer(ctx.token) });
  expect(res.statusCode).toBe(404);
});

test("the admin can make a reset link for anyone", async () => {
  const outsider = await addUser(ctx, { familyName: "Faraway" });
  const res = await ctx.app.inject({ method: "POST", url: `/api/admin/users/${outsider.userId}/reset-link`, headers: bearer(ctx.token) });
  expect(res.statusCode).toBe(201);
});

test("a new link replaces the previous one", async () => {
  const m = await addUser(ctx, { familyId: ctx.familyId });
  const first = (await ctx.app.inject({ method: "POST", url: `/api/family/members/${m.userId}/reset-link`, headers: bearer(ctx.token) })).json();
  await ctx.app.inject({ method: "POST", url: `/api/family/members/${m.userId}/reset-link`, headers: bearer(ctx.token) });
  expect((await ctx.app.inject({ method: "GET", url: `/api/password-resets/${tokenOf(first.path)}` })).statusCode).toBe(404);
});
