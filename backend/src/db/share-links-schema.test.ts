import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "./pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

test("share_links has target columns and no map_set_id", async () => {
  const cols = (await query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'share_links'")).rows.map((r) => r.column_name);
  expect(cols).toContain("target_type");
  expect(cols).toContain("target_id");
  expect(cols).not.toContain("map_set_id");
});

test("target_type allow-list rejects unknown types", async () => {
  await expect(
    query("INSERT INTO share_links (token, target_type, target_id, family_id) VALUES ('tok1','mapset',$1,$2)",
      ["00000000-0000-0000-0000-000000000000", ctx.familyId]),
  ).rejects.toThrow();
});

test("a trip target inserts cleanly", async () => {
  const tripId = (await query<{ id: string }>(
    "INSERT INTO trips (family_id, name) VALUES ($1,'T') RETURNING id", [ctx.familyId])).rows[0].id;
  const res = await query("INSERT INTO share_links (token, target_type, target_id, family_id) VALUES ('tok2','trip',$1,$2)",
    [tripId, ctx.familyId]);
  expect(res.rowCount).toBe(1);
});
