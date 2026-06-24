import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let listId: string, builtinId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  listId = (await query<{ id: string }>("INSERT INTO packing_lists (family_id, name) VALUES ($1,'Mine') RETURNING id", [ctx.familyId])).rows[0].id;
  builtinId = (await query<{ id: string }>("INSERT INTO packing_lists (family_id, trip_id, name, is_builtin) VALUES (NULL,NULL,'Beach',true) RETURNING id", [])).rows[0].id;
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("adds, checks, and deletes an item on a family list", async () => {
  const add = await ctx.app.inject({ method: "POST", url: `/api/packing/lists/${listId}/items`, headers: auth(), payload: { label: "Socks", category: "Clothes", qty: 5 } });
  expect(add.statusCode).toBe(201);
  const itemId = add.json().id;
  const check = await ctx.app.inject({ method: "PATCH", url: `/api/packing/items/${itemId}`, headers: auth(), payload: { checked: true } });
  expect(check.json().checked).toBe(true);
  const del = await ctx.app.inject({ method: "DELETE", url: `/api/packing/items/${itemId}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});

test("built-in lists are read-only (403)", async () => {
  const res = await ctx.app.inject({ method: "POST", url: `/api/packing/lists/${builtinId}/items`, headers: auth(), payload: { label: "x" } });
  expect(res.statusCode).toBe(403);
});

test("renames and deletes a family list", async () => {
  const rn = await ctx.app.inject({ method: "PATCH", url: `/api/packing/lists/${listId}`, headers: auth(), payload: { name: "Renamed" } });
  expect(rn.json().name).toBe("Renamed");
  const del = await ctx.app.inject({ method: "DELETE", url: `/api/packing/lists/${listId}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});
