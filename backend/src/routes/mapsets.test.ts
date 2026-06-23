import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("adds a visit to a map set and lists it", async () => {
  const ms = await query<{ id: string }>(
    "INSERT INTO map_sets (family_id, name) VALUES ($1,'Main') RETURNING id", [ctx.familyId]);
  const v = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title) VALUES ($1,'place','Tower') RETURNING id", [ctx.familyId]);

  const add = await ctx.app.inject({
    method: "POST", url: `/api/map-sets/${ms.rows[0].id}/visits`,
    headers: auth(), payload: { visitId: v.rows[0].id },
  });
  expect(add.statusCode).toBe(201);

  const list = await ctx.app.inject({
    method: "GET", url: `/api/map-sets/${ms.rows[0].id}/visits`, headers: auth() });
  expect(list.json()).toHaveLength(1);
});
