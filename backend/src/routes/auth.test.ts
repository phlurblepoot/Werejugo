import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../index.js";
import { pool, query } from "../db/pool.js";
import { config } from "../config.js";
import { resetDb } from "../test/helpers.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await resetDb();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });
const creator = { mode: "create", email: "first@test.dev", displayName: "First", password: "password123", familyName: "First Family" };

test("an empty server is in first-run mode with signup open", async () => {
  const res = await app.inject({ method: "GET", url: "/api/auth/config" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ firstRun: true, signupOpen: true });
});

test("the first person can create a family", async () => {
  const res = await post("/api/auth/register", creator);
  expect(res.statusCode).toBe(200);
  expect(res.json().user.role).toBe("owner");
});

test("after the first family, signup is closed", async () => {
  const cfg = await app.inject({ method: "GET", url: "/api/auth/config" });
  expect(cfg.json()).toEqual({ firstRun: false, signupOpen: false });
  const res = await post("/api/auth/register", { ...creator, email: "stranger@evil.test", familyName: "Strangers" });
  expect(res.statusCode).toBe(403);
  expect((await query("SELECT 1 FROM families")).rowCount).toBe(1);
});

test("people can still join an existing family with its invite code", async () => {
  const code = (await query<{ invite_code: string }>("SELECT invite_code FROM families")).rows[0].invite_code;
  const res = await post("/api/auth/register", {
    mode: "join", email: "kid@test.dev", displayName: "Kid", password: "password123", inviteCode: code,
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().user.role).toBe("member");
});

test("ALLOW_SIGNUP=true reopens family creation", async () => {
  config.allowSignup = true;
  try {
    const cfg = await app.inject({ method: "GET", url: "/api/auth/config" });
    expect(cfg.json().signupOpen).toBe(true);
    const res = await post("/api/auth/register", { ...creator, email: "second@test.dev", familyName: "Second Family" });
    expect(res.statusCode).toBe(200);
  } finally {
    config.allowSignup = false;
  }
});

test("login succeeds with the right password and fails otherwise", async () => {
  const ok = await post("/api/auth/login", { email: "first@test.dev", password: "password123" });
  expect(ok.statusCode).toBe(200);
  const bad = await post("/api/auth/login", { email: "first@test.dev", password: "nope-nope" });
  expect(bad.statusCode).toBe(401);
  const unknown = await post("/api/auth/login", { email: "ghost@test.dev", password: "password123" });
  expect(unknown.statusCode).toBe(401);
});

test("/me reports whether the user owns the server (the first family's owner)", async () => {
  const login = async (email: string) =>
    (await post("/api/auth/login", { email, password: "password123" })).json().token as string;
  const me = async (token: string) =>
    (await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } })).json();

  expect((await me(await login("first@test.dev"))).user.isInstanceOwner).toBe(true);
  expect((await me(await login("kid@test.dev"))).user.isInstanceOwner).toBe(false);
  // owner of a later family is not the server owner
  expect((await me(await login("second@test.dev"))).user.isInstanceOwner).toBe(false);
});

test("/me returns 401 (not 500) when the token's user no longer exists", async () => {
  const token = app.jwt.sign({ id: "00000000-0000-0000-0000-000000000000", familyId: "00000000-0000-0000-0000-000000000000", role: "owner" });
  const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } });
  expect(res.statusCode).toBe(401);
});
