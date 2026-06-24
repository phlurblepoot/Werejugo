import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string;
let tripToken: string;
let albumToken: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  tripId = (await query<{ id: string }>(
    "INSERT INTO trips (family_id, name, created_by) VALUES ($1,'Italy 2024',$2) RETURNING id", [ctx.familyId, ctx.userId])).rows[0].id;
  // a visit in the trip, with geometry, plus a linked photo
  const visitId = (await query<{ id: string }>(
    `INSERT INTO visits (family_id, trip_id, kind, title, geom, created_by)
     VALUES ($1,$2,'place','Colosseum', ST_SetSRID(ST_MakePoint(12.49,41.89),4326), $3) RETURNING id`,
    [ctx.familyId, tripId, ctx.userId])).rows[0].id;
  const mediaId = (await query<{ id: string }>(
    `INSERT INTO media (family_id, trip_id, kind, rel_path, original_name, created_by)
     VALUES ($1,$2,'image','trips/italy/photos/colosseum.jpg','colosseum.jpg',$3) RETURNING id`,
    [ctx.familyId, tripId, ctx.userId])).rows[0].id;
  await query(
    "INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role) VALUES ($1,'media',$2,'visit',$3,'appears_in')",
    [ctx.familyId, mediaId, visitId]);
  await query("INSERT INTO itinerary_items (family_id, trip_id, title, seq) VALUES ($1,$2,'Visit the Forum',0)", [ctx.familyId, tripId]);
  // a private document on the trip — must NEVER appear in a share payload
  await query("INSERT INTO documents (family_id, title, doc_type, owner_trip_id) VALUES ($1,'Booking','booking',$2)", [ctx.familyId, tripId]);

  tripToken = (await query<{ token: string }>(
    "INSERT INTO share_links (token, target_type, target_id, family_id) VALUES ('triptok123456789012','trip',$1,$2) RETURNING token",
    [tripId, ctx.familyId])).rows[0].token;
  albumToken = (await query<{ token: string }>(
    "INSERT INTO share_links (token, target_type, target_id, family_id) VALUES ('albmtok123456789012','album',$1,$2) RETURNING token",
    [tripId, ctx.familyId])).rows[0].token;
});
afterAll(async () => { await closeTestApp(ctx); });

test("a trip share returns trip, visits, itinerary, photos — and no documents", async () => {
  const res = await ctx.app.inject({ method: "GET", url: `/api/share/${tripToken}` });
  expect(res.statusCode).toBe(200);
  const b = res.json();
  expect(b.targetType).toBe("trip");
  expect(b.trip.name).toBe("Italy 2024");
  expect(b.visits).toHaveLength(1);
  expect(b.visits[0].geometry).toMatchObject({ type: "Point" });
  expect(b.visits[0].photos[0].url).toContain("sig=");
  expect(b.itinerary.map((i: any) => i.title)).toEqual(["Visit the Forum"]);
  expect(JSON.stringify(b)).not.toContain("Booking"); // documents never shared
});

test("an album share returns a flat photo list", async () => {
  const res = await ctx.app.inject({ method: "GET", url: `/api/share/${albumToken}` });
  expect(res.statusCode).toBe(200);
  const b = res.json();
  expect(b.targetType).toBe("album");
  expect(b.photos).toHaveLength(1);
  expect(b.photos[0].url).toContain("sig=");
});

test("an unknown token is 404", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/share/nope" });
  expect(res.statusCode).toBe(404);
});
