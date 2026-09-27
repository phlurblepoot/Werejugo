import { afterAll, beforeAll, expect, test } from "vitest";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const put = (payload: unknown, token = ctx.token) => ctx.app.inject({ method: "PUT", url: "/api/settings", headers: bearer(token), payload: payload as object });

test("the family's map look: saved by an owner, read by everyone in the family", async () => {
  const look = {
    pin: { default: { color: "#112233", size: 30 }, byKind: { food: { icon: "utensils", shape: "square" } }, byLine: { "Royal Caribbean": { color: "#003399" } } },
    path: { byKind: { drive: { style: "tire", width: 9 } } },
    map: { styleUrl: "https://tiles.example/style.json" },
  };
  const saved = await put(look);
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toEqual(look);
  const member = await addUser(ctx, { familyId: ctx.familyId });
  expect((await ctx.app.inject({ method: "GET", url: "/api/settings", headers: bearer(member.token) })).json()).toEqual(look);
});

test("only a family owner changes it", async () => {
  const member = await addUser(ctx, { familyId: ctx.familyId });
  const r = await put({ pin: { default: { color: "#000000" } } }, member.token);
  expect(r.statusCode).toBe(403);
});

test("nonsense is a 400 that says what's wrong", async () => {
  for (const bad of [
    [1, 2],
    { pin: { default: { size: "huge" } } },
    { pin: { byKind: { spaceship: { color: "#fff" } } } },
    { pin: { default: { shape: "star" } } },
    { path: { default: { style: "zigzag" } } },
    { map: { styleUrl: "javascript:alert(1)" } },
  ]) {
    expect((await put(bad)).statusCode).toBe(400);
  }
  expect((await put({ note: "x".repeat(60_000) })).statusCode).toBe(400);
});
