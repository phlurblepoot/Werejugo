import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string, personId: string, visitId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  const t = await query<{ id: string }>("INSERT INTO trips (family_id, name, start_date, end_date) VALUES ($1,'Italy','2024-06-01','2024-06-30') RETURNING id", [ctx.familyId]);
  tripId = t.rows[0].id;
  const p = await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1,'Mom') RETURNING id", [ctx.familyId]);
  personId = p.rows[0].id;
  const v = await query<{ id: string }>("INSERT INTO visits (family_id, kind, title, geom) VALUES ($1,'place','Colosseum', ST_SetSRID(ST_MakePoint(12.4924,41.8902),4326)) RETURNING id", [ctx.familyId]);
  visitId = v.rows[0].id;
  // m1: in trip, taken June, near colosseum, linked to Mom
  const m1 = await query<{ id: string }>(
    `INSERT INTO media (family_id, kind, rel_path, taken_at, geom, trip_id) VALUES
     ($1,'image','loose/2024/a.jpg','2024-06-10T10:00:00Z', ST_SetSRID(ST_MakePoint(12.4925,41.8903),4326), $2) RETURNING id`, [ctx.familyId, tripId]);
  await query("INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role) VALUES ($1,'media',$2,'person',$3,'shows')", [ctx.familyId, m1.rows[0].id, personId]);
  // m2: no trip, taken March, no geom
  await query("INSERT INTO media (family_id, kind, rel_path, taken_at) VALUES ($1,'image','loose/2024/b.jpg','2024-03-05T10:00:00Z')", [ctx.familyId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("lists all family media newest-first with cursors", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/media", headers: auth() });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.items).toHaveLength(2);
  expect(body.items[0].takenAt).toContain("2024-06-10"); // newest first
  expect(body.items[0].url).toContain("/api/files/");
  expect(body.items[0].cursor).toBeTruthy();
});

test("filters by trip, person, date range, and bbox", async () => {
  const byTrip = await ctx.app.inject({ method: "GET", url: `/api/media?trip=${tripId}`, headers: auth() });
  expect(byTrip.json().items).toHaveLength(1);
  const byPerson = await ctx.app.inject({ method: "GET", url: `/api/media?person=${personId}`, headers: auth() });
  expect(byPerson.json().items).toHaveLength(1);
  const byVisit = await ctx.app.inject({ method: "GET", url: `/api/media?visit=${visitId}`, headers: auth() });
  expect(byVisit.json().items).toHaveLength(0); // not linked to the visit
  const byDate = await ctx.app.inject({ method: "GET", url: "/api/media?from=2024-06-01&to=2024-06-30", headers: auth() });
  expect(byDate.json().items).toHaveLength(1);
  const byBbox = await ctx.app.inject({ method: "GET", url: "/api/media?bbox=12,41,13,42", headers: auth() });
  expect(byBbox.json().items).toHaveLength(1); // only m1 has geom
});

test("paginates with limit + before cursor", async () => {
  const page1 = await ctx.app.inject({ method: "GET", url: "/api/media?limit=1", headers: auth() });
  expect(page1.json().items).toHaveLength(1);
  expect(page1.json().nextCursor).toBeTruthy();
  const page2 = await ctx.app.inject({ method: "GET", url: `/api/media?limit=1&before=${encodeURIComponent(page1.json().nextCursor)}`, headers: auth() });
  expect(page2.json().items).toHaveLength(1);
  expect(page2.json().items[0].id).not.toBe(page1.json().items[0].id);
});
