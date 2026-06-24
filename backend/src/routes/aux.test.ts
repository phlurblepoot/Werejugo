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

// NOTE: map-set sharing was retired in phase 8A (Task 3/4) — maps are no longer
// shareable; sharing is now trip/album-based (see share-public.test.ts). The old
// public map-set share test was removed because it exercised a deleted route.
