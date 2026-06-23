import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await buildTestApp();
  await query("INSERT INTO visits (family_id, kind, title) VALUES ($1,'place','Eiffel Tower'), ($1,'food','Eiffel Cafe')", [ctx.familyId]);
  await query("INSERT INTO people (family_id, display_name) VALUES ($1,'Eileen')", [ctx.familyId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("searches visits by title", async () => {
  const res = await ctx.app.inject({
    method: "GET", url: "/api/entities/search?type=visit&q=eiffel", headers: auth() });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toHaveLength(2);
  expect(res.json()[0]).toMatchObject({ type: "visit" });
});

test("searches people by name", async () => {
  const res = await ctx.app.inject({
    method: "GET", url: "/api/entities/search?type=person&q=eil", headers: auth() });
  expect(res.json()).toHaveLength(1);
  expect(res.json()[0].label).toBe("Eileen");
});

test("rejects an unknown type", async () => {
  const res = await ctx.app.inject({
    method: "GET", url: "/api/entities/search?type=dragon&q=x", headers: auth() });
  expect(res.statusCode).toBe(400);
});

test("empty query returns an empty list", async () => {
  const res = await ctx.app.inject({
    method: "GET", url: "/api/entities/search?type=visit&q=", headers: auth() });
  expect(res.json()).toEqual([]);
});
