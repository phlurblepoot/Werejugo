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

test("converts an item to a visit and is idempotent", async () => {
  const item = await ctx.app.inject({ method: "POST", url: `/api/trips/${tripId}/itinerary`, headers: auth(),
    payload: { title: "Colosseum", scheduledOn: "2025-06-04", lat: 41.8902, lng: 12.4924 } });
  const id = item.json().id;

  const conv = await ctx.app.inject({ method: "POST", url: `/api/itinerary/${id}/convert`, headers: auth() });
  expect(conv.statusCode).toBe(200);
  const visitId = conv.json().visitId;
  const v = await query<{ title: string; trip_id: string; occurred_on: string; geom: string | null }>(
    "SELECT title, trip_id, to_char(occurred_on,'YYYY-MM-DD') AS occurred_on, ST_AsText(geom) AS geom FROM visits WHERE id = $1", [visitId]);
  expect(v.rows[0]).toMatchObject({ title: "Colosseum", trip_id: tripId, occurred_on: "2025-06-04" });
  expect(v.rows[0].geom).toContain("POINT");

  // idempotent: second convert returns the same visit
  const again = await ctx.app.inject({ method: "POST", url: `/api/itinerary/${id}/convert`, headers: auth() });
  expect(again.json().visitId).toBe(visitId);
  const count = await query("SELECT 1 FROM visits WHERE trip_id = $1", [tripId]);
  expect(count.rowCount).toBe(1);
});
