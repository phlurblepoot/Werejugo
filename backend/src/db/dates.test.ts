import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "./pool.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await buildTestApp();
  const trip = (await query<{ id: string }>(
    "INSERT INTO trips (family_id, name, start_date, end_date, created_by) VALUES ($1,'Italy','2024-06-01','2024-06-10',$2) RETURNING id",
    [ctx.familyId, ctx.userId])).rows[0].id;
  await query(
    "INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, created_by) VALUES ($1,$2,'place','Colosseum','2024-06-02',$3)",
    [ctx.familyId, trip, ctx.userId]);
});
afterAll(async () => { await closeTestApp(ctx); });

// node-pg used to parse DATE as local midnight and serialize it as a UTC
// timestamp, so on a server east of UTC every date slipped back a day.
test("DATE columns are plain YYYY-MM-DD strings, whatever the server timezone", async () => {
  const prev = process.env.TZ;
  process.env.TZ = "Europe/Berlin";
  try {
    const auth = { authorization: `Bearer ${ctx.token}` };
    const trips = (await ctx.app.inject({ method: "GET", url: "/api/trips", headers: auth })).json();
    expect(trips[0]).toMatchObject({ startDate: "2024-06-01", endDate: "2024-06-10" });
    const visits = (await ctx.app.inject({ method: "GET", url: "/api/visits", headers: auth })).json();
    expect(visits[0].occurredOn).toBe("2024-06-02");
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
});
