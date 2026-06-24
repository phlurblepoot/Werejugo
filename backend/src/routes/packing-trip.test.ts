import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string, templateId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  tripId = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1,'Italy') RETURNING id", [ctx.familyId])).rows[0].id;
  templateId = (await query<{ id: string }>("INSERT INTO packing_lists (family_id, name) VALUES ($1,'Base') RETURNING id", [ctx.familyId])).rows[0].id;
  await query("INSERT INTO packing_items (list_id, label, category, checked, seq) VALUES ($1,'Passport','Docs',true,0)", [templateId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("a trip with no list returns null, then seeds from a template (items unchecked)", async () => {
  const empty = await ctx.app.inject({ method: "GET", url: `/api/trips/${tripId}/packing`, headers: auth() });
  expect(empty.json().list).toBeNull();

  const create = await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/packing`, headers: auth(), payload: { fromTemplateId: templateId } });
  expect(create.statusCode).toBe(201);
  expect(create.json().items).toHaveLength(1);
  expect(create.json().items[0]).toMatchObject({ label: "Passport", checked: false }); // copied, unchecked

  // idempotent: second POST returns the existing list
  const again = await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/packing`, headers: auth(), payload: {} });
  expect(again.json().id).toBe(create.json().id);
});

test("saves a list as a template (items copied, unchecked)", async () => {
  const get = await ctx.app.inject({ method: "GET", url: `/api/trips/${tripId}/packing`, headers: auth() });
  const listId = get.json().list.id;
  // check the trip item so we can prove the template copy is reset
  await query("UPDATE packing_items SET checked = true WHERE list_id = $1", [listId]);

  const tpl = await ctx.app.inject({ method: "POST", url: "/api/packing/templates", headers: auth(), payload: { name: "Italy base", fromListId: listId } });
  expect(tpl.statusCode).toBe(201);
  const tplId = tpl.json().id;
  const items = await query<{ checked: boolean }>("SELECT checked FROM packing_items WHERE list_id = $1", [tplId]);
  expect(items.rows.every((r) => r.checked === false)).toBe(true);
});
