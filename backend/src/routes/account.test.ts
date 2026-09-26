import { afterAll, beforeAll, expect, test } from "vitest";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

test("people can rename themselves and pick a colour", async () => {
  const u = await addUser(ctx, { familyId: ctx.familyId });
  const res = await ctx.app.inject({ method: "PATCH", url: "/api/account", headers: bearer(u.token), payload: { displayName: "Grandpa Joe", color: "#b45309" } });
  expect(res.json().user).toMatchObject({ displayName: "Grandpa Joe", color: "#b45309" });
  expect((await ctx.app.inject({ method: "PATCH", url: "/api/account", headers: bearer(u.token), payload: { color: "red" } })).statusCode).toBe(400);
});

test("changing the password needs the current one and signs out other sessions", async () => {
  const u = await addUser(ctx, { familyId: ctx.familyId, email: "pw@test.dev", password: "first-password" });
  const wrong = await ctx.app.inject({ method: "POST", url: "/api/account/password", headers: bearer(u.token), payload: { currentPassword: "nope", newPassword: "second-password" } });
  expect(wrong.statusCode).toBe(400);

  const ok = await ctx.app.inject({ method: "POST", url: "/api/account/password", headers: bearer(u.token), payload: { currentPassword: "first-password", newPassword: "second-password" } });
  expect(ok.statusCode).toBe(200);
  expect((await ctx.app.inject({ method: "GET", url: "/api/trips", headers: bearer(u.token) })).statusCode).toBe(401);
  expect((await ctx.app.inject({ method: "GET", url: "/api/trips", headers: bearer(ok.json().token) })).statusCode).toBe(200);
});

test("sign out everywhere revokes every token", async () => {
  const u = await addUser(ctx, { familyId: ctx.familyId });
  expect((await ctx.app.inject({ method: "POST", url: "/api/account/sign-out-everywhere", headers: bearer(u.token) })).statusCode).toBe(200);
  expect((await ctx.app.inject({ method: "GET", url: "/api/trips", headers: bearer(u.token) })).statusCode).toBe(401);
});
