import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string, visitId: string, m1: string, m2: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  tripId = (await query<{ id: string }>("INSERT INTO trips (family_id, name, start_date, end_date) VALUES ($1,'Italy','2024-06-01','2024-06-30') RETURNING id", [ctx.familyId])).rows[0].id;
  visitId = (await query<{ id: string }>("INSERT INTO visits (family_id, kind, title, geom) VALUES ($1,'place','Colosseum', ST_SetSRID(ST_MakePoint(12.4924,41.8902),4326)) RETURNING id", [ctx.familyId])).rows[0].id;
  m1 = (await query<{ id: string }>("INSERT INTO media (family_id, kind, rel_path, taken_at, geom) VALUES ($1,'image','loose/2024/a.jpg','2024-06-10T10:00:00Z', ST_SetSRID(ST_MakePoint(12.4925,41.8903),4326)) RETURNING id", [ctx.familyId])).rows[0].id;
  m2 = (await query<{ id: string }>("INSERT INTO media (family_id, kind, rel_path, taken_at) VALUES ($1,'image','loose/2024/b.jpg','2023-01-01T10:00:00Z') RETURNING id", [ctx.familyId])).rows[0].id;
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("suggests a trip by date and a visit by proximity", async () => {
  const res = await ctx.app.inject({ method: "POST", url: "/api/media/suggestions", headers: auth(), payload: { mediaIds: [m1, m2] } });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const trip = body.trips.find((t: any) => t.tripId === tripId);
  expect(trip.mediaIds).toEqual([m1]); // only m1's date is in range
  const visit = body.visits.find((v: any) => v.visitId === visitId);
  expect(visit.mediaIds).toEqual([m1]); // only m1 is near the colosseum
});
