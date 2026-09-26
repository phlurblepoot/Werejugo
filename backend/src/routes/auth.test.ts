import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../index.js";
import { pool, query } from "../db/pool.js";
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
const admin = { email: "admin@test.dev", displayName: "Admin", password: "password123", familyName: "First Family" };
const me = async (token: string) =>
  app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } });

test("an empty server is in first-run mode", async () => {
  const res = await app.inject({ method: "GET", url: "/api/auth/config" });
  expect(res.json()).toEqual({ firstRun: true });
});

test("setup creates the first family and makes its owner the server admin", async () => {
  const res = await post("/api/auth/setup", admin);
  expect(res.statusCode).toBe(200);
  expect(res.json().user).toMatchObject({ role: "owner", isAdmin: true });
  const who = (await me(res.json().token)).json();
  expect(who.user.isAdmin).toBe(true);
  expect(who.family.name).toBe("First Family");
  expect((await app.inject({ method: "GET", url: "/api/auth/config" })).json()).toEqual({ firstRun: false });
});

test("setup can only happen once", async () => {
  const res = await post("/api/auth/setup", { ...admin, email: "sneaky@evil.test", familyName: "Takeover" });
  expect(res.statusCode).toBe(403);
  expect((await query("SELECT 1 FROM families")).rowCount).toBe(1);
});

test("open registration is gone", async () => {
  const res = await post("/api/auth/register", { mode: "create", email: "x@evil.test", displayName: "X", password: "password123", familyName: "X" });
  expect(res.statusCode).toBe(410);
});

test("login succeeds with the right password and fails otherwise", async () => {
  expect((await post("/api/auth/login", { email: "admin@test.dev", password: "password123" })).statusCode).toBe(200);
  expect((await post("/api/auth/login", { email: "admin@test.dev", password: "nope-nope" })).statusCode).toBe(401);
  expect((await post("/api/auth/login", { email: "ghost@test.dev", password: "password123" })).statusCode).toBe(401);
});

test("login records when the user last signed in", async () => {
  const at = (await query<{ last_login_at: Date | null }>("SELECT last_login_at FROM users WHERE email = 'admin@test.dev'")).rows[0].last_login_at;
  expect(at).not.toBeNull();
});

test("a disabled account cannot sign in", async () => {
  await query("UPDATE users SET disabled_at = now() WHERE email = 'admin@test.dev'");
  try {
    expect((await post("/api/auth/login", { email: "admin@test.dev", password: "password123" })).statusCode).toBe(403);
  } finally {
    await query("UPDATE users SET disabled_at = NULL WHERE email = 'admin@test.dev'");
  }
});

test("/me returns 401 (not 500) when the token's user no longer exists", async () => {
  const token = app.jwt.sign({ id: "00000000-0000-0000-0000-000000000000", familyId: "00000000-0000-0000-0000-000000000000", role: "owner" });
  expect((await me(token)).statusCode).toBe(401);
});
