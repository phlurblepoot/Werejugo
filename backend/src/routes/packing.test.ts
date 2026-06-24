import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let builtinId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  builtinId = (await query<{ id: string }>(
    "INSERT INTO packing_lists (family_id, trip_id, name, is_builtin) VALUES (NULL, NULL, 'Beach', true) RETURNING id", [])).rows[0].id;
  await query("INSERT INTO packing_items (list_id, label, category, seq) VALUES ($1,'Swimsuit','Clothes',0)", [builtinId]);
  // a family template
  await query("INSERT INTO packing_lists (family_id, name) VALUES ($1,'My template')", [ctx.familyId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("templates lists built-ins + family templates with item counts", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/packing/templates", headers: auth() });
  const names = res.json().map((l: any) => l.name).sort();
  expect(names).toEqual(["Beach", "My template"]);
  const beach = res.json().find((l: any) => l.name === "Beach");
  expect(beach).toMatchObject({ isBuiltin: true, itemCount: 1 });
});

test("a list detail returns its items", async () => {
  const res = await ctx.app.inject({ method: "GET", url: `/api/packing/lists/${builtinId}`, headers: auth() });
  expect(res.json().items).toHaveLength(1);
  expect(res.json().items[0]).toMatchObject({ label: "Swimsuit", category: "Clothes" });
});
