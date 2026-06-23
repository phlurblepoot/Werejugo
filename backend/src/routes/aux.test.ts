import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await buildTestApp();
  await query("INSERT INTO visits (family_id, kind, title, occurred_on) VALUES ($1,'place','A','2024-01-01')", [ctx.familyId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("stats endpoint returns counts over visits", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/stats", headers: auth() });
  expect(res.statusCode).toBe(200);
  expect(res.json().items).toBe(1);
});

test("export includes visits", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/export", headers: auth() });
  expect(res.statusCode).toBe(200);
  expect(Array.isArray(res.json().visits)).toBe(true);
  expect(res.json().visits.length).toBeGreaterThanOrEqual(1);
});

test("public share returns a map's member visits with a photos array", async () => {
  const ms = await query<{ id: string }>(
    "INSERT INTO map_sets (family_id, name) VALUES ($1,'M') RETURNING id", [ctx.familyId]);
  const v = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title) VALUES ($1,'food','B') RETURNING id", [ctx.familyId]);
  await query("INSERT INTO map_set_visits (map_set_id, visit_id) VALUES ($1,$2)", [ms.rows[0].id, v.rows[0].id]);

  const share = await ctx.app.inject({
    method: "POST", url: `/api/map-sets/${ms.rows[0].id}/shares`, headers: auth() });
  const token = share.json().token;
  const res = await ctx.app.inject({ method: "GET", url: `/api/share/${token}` });
  expect(res.statusCode).toBe(200);
  expect(res.json().items).toHaveLength(1);
  expect(Array.isArray(res.json().items[0].photos)).toBe(true);
});
