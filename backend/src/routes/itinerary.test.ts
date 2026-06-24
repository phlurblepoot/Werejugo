import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  tripId = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1,'Italy') RETURNING id", [ctx.familyId])).rows[0].id;
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates scheduled and wishlist items and lists them (scheduled first)", async () => {
  const wish = await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/itinerary`, headers: auth(), payload: { title: "Gelato crawl" } });
  expect(wish.json().scheduledOn).toBeNull();
  await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/itinerary`, headers: auth(), payload: { title: "Colosseum", scheduledOn: "2025-06-04" } });

  const list = await ctx.app.inject({ method: "GET", url: `/api/trips/${tripId}/itinerary`, headers: auth() });
  const items = list.json();
  expect(items).toHaveLength(2);
  expect(items[0].title).toBe("Colosseum"); // scheduled first
});

test("schedules a wishlist item via patch and deletes it", async () => {
  const created = await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/itinerary`, headers: auth(), payload: { title: "Tuscany" } });
  const id = created.json().id;
  const patch = await ctx.app.inject({ method: "PATCH", url: `/api/itinerary/${id}`, headers: auth(), payload: { scheduledOn: "2025-06-08" } });
  expect(patch.json().scheduledOn).toBe("2025-06-08");
  const del = await ctx.app.inject({ method: "DELETE", url: `/api/itinerary/${id}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});
