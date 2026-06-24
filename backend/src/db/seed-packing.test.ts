import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "./pool.js";
import { seedPacking } from "./seed.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

test("seedPacking inserts built-in templates with items, idempotently", async () => {
  await seedPacking();
  await seedPacking(); // second run must not duplicate
  const lists = await query<{ n: string }>("SELECT COUNT(*)::int AS n FROM packing_lists WHERE is_builtin = true");
  expect(Number(lists.rows[0].n)).toBeGreaterThanOrEqual(3);
  const carry = await query<{ id: string }>("SELECT id FROM packing_lists WHERE is_builtin = true AND name = 'Carry-on essentials'");
  expect(carry.rowCount).toBe(1);
  const items = await query("SELECT 1 FROM packing_items WHERE list_id = $1", [carry.rows[0].id]);
  expect(items.rowCount).toBeGreaterThan(0);
});
