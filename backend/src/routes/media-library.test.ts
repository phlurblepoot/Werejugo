import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { query } from "../db/pool.js";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
afterEach(async () => {
  await query("DELETE FROM links");
  await query("DELETE FROM media");
  await query("DELETE FROM itinerary_items");
  await query("DELETE FROM visits");
  await query("DELETE FROM trips");
  await query("DELETE FROM people");
});

type Json = Record<string, any>;
const get = (url: string, token = ctx.token) => ctx.app.inject({ method: "GET", url, headers: bearer(token) });
const post = (url: string, payload: object, token = ctx.token) => ctx.app.inject({ method: "POST", url, headers: bearer(token), payload });

/** A photo in the library (straight into the table: these routes don't talk to Immich). */
async function photo(o: { takenAt?: string | null; lng?: number; lat?: number; kind?: "image" | "video"; tripId?: string; hidden?: boolean; familyId?: string; name?: string } = {}) {
  return (await query<{ id: string }>(
    `INSERT INTO media (family_id, immich_asset_id, kind, original_name, taken_at, geom, trip_id, hidden_at)
     VALUES ($1, gen_random_uuid(), $2, $3, $4,
             CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5, $6), 4326) END, $7, $8) RETURNING id`,
    [o.familyId ?? ctx.familyId, o.kind ?? "image", o.name ?? "p.jpg", o.takenAt === undefined ? "2024-06-10T12:00:00Z" : o.takenAt,
      o.lng ?? null, o.lat ?? null, o.tripId ?? null, o.hidden ? new Date() : null])).rows[0].id;
}
const one = async (sql: string, params: unknown[]) => (await query<{ id: string }>(sql, params)).rows[0].id;

test("the timeline counts photos per month, newest first, with the same filters as the list", async () => {
  await photo({ takenAt: "2024-06-01T10:00:00Z" });
  await photo({ takenAt: "2024-06-30T23:00:00Z", kind: "video" });
  await photo({ takenAt: "2023-12-31T10:00:00Z" });
  await photo({ takenAt: "2019-03-03T10:00:00Z", hidden: true });
  const t = (await get("/api/media/timeline")).json();
  expect(t).toEqual({ months: [{ month: "2024-06", count: 2 }, { month: "2023-12", count: 1 }], total: 3 });
  expect((await get("/api/media/timeline?kind=video")).json().months).toEqual([{ month: "2024-06", count: 1 }]);
  expect((await get("/api/media/timeline?hidden=only")).json().months).toEqual([{ month: "2019-03", count: 1 }]);

  // A month's photos, in the same order.
  const june = (await get("/api/media?month=2024-06")).json().items;
  expect(june.map((m: Json) => m.takenAt)).toEqual(["2024-06-30T23:00:00.000Z", "2024-06-01T10:00:00.000Z"]);
  expect((await get("/api/media?month=2024-13")).statusCode).toBe(400);
});

test("hidden photos leave the library, the map and counts, and come back when shown", async () => {
  const a = await photo({ lng: 2.35, lat: 48.85 });
  const b = await photo({ lng: 2.36, lat: 48.86 });
  const patch = await ctx.app.inject({ method: "PATCH", url: `/api/media/${a}`, headers: bearer(ctx.token), payload: { hidden: true } });
  expect(patch.json()).toMatchObject({ id: a, hidden: true });
  expect((await get("/api/media")).json().items.map((m: Json) => m.id)).toEqual([b]);
  expect((await get("/api/media/geo")).json().points.map((p: unknown[]) => p[0])).toEqual([b]);
  expect((await get("/api/media?hidden=only")).json().items.map((m: Json) => m.id)).toEqual([a]);

  // In bulk: hide both, then show both.
  expect((await post("/api/media/bulk", { mediaIds: [a, b], hidden: true })).json()).toEqual({ updated: 2 });
  expect((await get("/api/media/timeline")).json().total).toBe(0);
  await post("/api/media/bulk", { mediaIds: [a, b], hidden: false });
  expect((await get("/api/media/timeline")).json().total).toBe(2);
});

test("the map gets compact points for every geotagged photo, and links only for what it may show", async () => {
  const a = await photo({ lng: 12.49, lat: 41.89, kind: "video" });
  await photo(); // no place
  const other = await addUser(ctx, { familyName: "Others", role: "owner" });
  const theirs = await photo({ lng: 1, lat: 1, familyId: other.familyId });
  expect((await get("/api/media/geo")).json()).toEqual({ points: [[a, 12.49, 41.89, "video"]] });

  const links = (await post("/api/media/links", { ids: [a, theirs] })).json();
  expect(Object.keys(links)).toEqual([a]);
  expect(links[a].thumbUrl).toMatch(new RegExp(`^/api/m/${a}/thumbnail\\?e=`));
  expect((await post("/api/media/links", { ids: Array.from({ length: 201 }, () => a) })).statusCode).toBe(400);
});

test("bulk: put photos in a trip (or none); only my own photos", async () => {
  const trip = await one("INSERT INTO trips (family_id, name) VALUES ($1, 'Italy') RETURNING id", [ctx.familyId]);
  const a = await photo();
  const b = await photo();
  await post("/api/media/bulk", { mediaIds: [a, b], tripId: trip });
  expect((await get(`/api/media/timeline?trip=${trip}`)).json().total).toBe(2);
  expect((await get("/api/media/timeline?noTrip=1")).json().total).toBe(0);
  await post("/api/media/bulk", { mediaIds: [a], tripId: null });
  expect((await get("/api/media/timeline?noTrip=1")).json().total).toBe(1);

  const other = await addUser(ctx, { familyName: "Others", role: "owner" });
  expect((await post("/api/media/bulk", { mediaIds: [a], hidden: true }, other.token)).statusCode).toBe(400);
});

test("the picker opens a place on the photos taken then and there, both first", async () => {
  const visit = await one(
    `INSERT INTO visits (family_id, kind, title, occurred_on, geom) VALUES ($1, 'place', 'Colosseum', '2024-06-10', ST_SetSRID(ST_MakePoint(12.4922, 41.8902), 4326)) RETURNING id`,
    [ctx.familyId]);
  const both = await photo({ takenAt: "2024-06-10T09:00:00Z", lng: 12.4925, lat: 41.8905 });
  const sameDay = await photo({ takenAt: "2024-06-11T20:00:00Z", lng: 2.35, lat: 48.85 }); // a day later, in Paris
  const samePlace = await photo({ takenAt: "2019-01-01T09:00:00Z", lng: 12.49, lat: 41.89 });
  await photo({ takenAt: "2024-07-01T09:00:00Z", lng: 2.35, lat: 48.85 }); // neither
  await photo({ takenAt: "2024-06-10T10:00:00Z", lng: 12.4922, lat: 41.8902, hidden: true });

  const r = (await get(`/api/media/for?entity=visit:${visit}`)).json();
  expect(r).toMatchObject({ label: "Colosseum", window: { from: "2024-06-10", to: "2024-06-10" }, near: true, month: "2024-06" });
  expect(r.items.map((m: Json) => [m.id, m.match])).toEqual([[both, "both"], [sameDay, "date"], [samePlace, "place"]]);
  expect(r.items.every((m: Json) => m.attached === false)).toBe(true);

  // Attach two: they're linked (as appearing there) and marked as added.
  const att = (await post("/api/media/attach", { mediaIds: [both, samePlace], to: `visit:${visit}` })).json();
  expect(att).toEqual({ attached: 2, skipped: [] });
  const again = (await get(`/api/media/for?entity=visit:${visit}`)).json();
  expect(again.items.filter((m: Json) => m.attached).map((m: Json) => m.id).sort()).toEqual([both, samePlace].sort());
  const role = (await query("SELECT role FROM links WHERE from_id = $1", [both])).rows[0].role;
  expect(role).toBe("appears_in");
});

test("a trip: its dates and its places; attaching puts the photos in the trip", async () => {
  const trip = await one("INSERT INTO trips (family_id, name, start_date, end_date) VALUES ($1, 'Lisbon', '2023-03-03', '2023-03-09') RETURNING id", [ctx.familyId]);
  await query(`INSERT INTO visits (family_id, trip_id, kind, title, geom) VALUES ($1, $2, 'place', 'Belém', ST_SetSRID(ST_MakePoint(-9.2155, 38.6916), 4326))`, [ctx.familyId, trip]);
  const during = await photo({ takenAt: "2023-03-05T12:00:00Z" });
  const dayBefore = await photo({ takenAt: "2023-03-02T12:00:00Z" });
  const nearLater = await photo({ takenAt: "2025-01-01T12:00:00Z", lng: -9.216, lat: 38.692 });
  await photo({ takenAt: "2023-03-20T12:00:00Z" });

  const r = (await get(`/api/media/for?entity=trip:${trip}`)).json();
  expect(r.month).toBe("2023-03");
  expect(r.items.map((m: Json) => m.id).sort()).toEqual([during, dayBefore, nearLater].sort());
  await post("/api/media/attach", { mediaIds: [during, dayBefore], to: `trip:${trip}` });
  expect((await get(`/api/media?trip=${trip}`)).json().items.map((m: Json) => m.id).sort()).toEqual([during, dayBefore].sort());
  expect((await get(`/api/media/for?entity=trip:${trip}`)).json().items.find((m: Json) => m.id === during).attached).toBe(true);
});

test("a person: the dates of the trips and places they're tagged in; attaching tags them", async () => {
  const person = await one("INSERT INTO people (family_id, display_name) VALUES ($1, 'Grandma') RETURNING id", [ctx.familyId]);
  const trip = await one("INSERT INTO trips (family_id, name, start_date, end_date) VALUES ($1, 'Tahoe', '2025-07-10', '2025-07-14') RETURNING id", [ctx.familyId]);
  await query("INSERT INTO links (family_id, from_type, from_id, to_type, to_id) VALUES ($1, 'person', $2, 'trip', $3)", [ctx.familyId, person, trip]);
  const lake = await photo({ takenAt: "2025-07-12T15:00:00Z" });
  await photo({ takenAt: "2025-09-01T15:00:00Z" });

  const r = (await get(`/api/media/for?entity=person:${person}`)).json();
  expect(r).toMatchObject({ label: "Grandma", near: false, month: "2025-07" });
  expect(r.items.map((m: Json) => m.id)).toEqual([lake]);
  expect((await post("/api/media/attach", { mediaIds: [lake], to: `person:${person}` })).json().attached).toBe(1);
  expect((await get(`/api/media?person=${person}`)).json().items.map((m: Json) => m.id)).toEqual([lake]);
});

test("an itinerary item: its day and place; attaching puts the photos in its trip, and its place once it has one", async () => {
  const trip = await one("INSERT INTO trips (family_id, name, start_date, end_date) VALUES ($1, 'Rome', '2024-06-08', '2024-06-12') RETURNING id", [ctx.familyId]);
  const item = await one("INSERT INTO itinerary_items (family_id, trip_id, title, scheduled_on, lat, lng) VALUES ($1, $2, 'Vatican', '2024-06-11', 41.9029, 12.4534) RETURNING id", [ctx.familyId, trip]);
  const there = await photo({ takenAt: "2024-06-11T10:00:00Z", lng: 12.4536, lat: 41.9030 });
  const res = await get(`/api/media/for?entity=itinerary:${item}`);
  expect(res.statusCode, res.body).toBe(200);
  const r = res.json();
  expect(r.items.map((m: Json) => [m.id, m.match])).toEqual([[there, "both"]]);

  await post("/api/media/attach", { mediaIds: [there], to: `itinerary:${item}` });
  expect((await query("SELECT trip_id FROM media WHERE id = $1", [there])).rows[0].trip_id).toBe(trip);
  expect((await query("SELECT count(*)::int AS n FROM links")).rows[0].n).toBe(0);

  const visit = await one(`INSERT INTO visits (family_id, trip_id, kind, title) VALUES ($1, $2, 'place', 'Vatican') RETURNING id`, [ctx.familyId, trip]);
  await query("UPDATE itinerary_items SET converted_visit_id = $1 WHERE id = $2", [visit, item]);
  await post("/api/media/attach", { mediaIds: [there], to: `itinerary:${item}` });
  expect((await query("SELECT to_id FROM links WHERE from_id = $1", [there])).rows[0].to_id).toBe(visit);
});

test("nothing to go on (no date, no place): no suggestions, the library opens at the top", async () => {
  const visit = await one("INSERT INTO visits (family_id, kind, title) VALUES ($1, 'place', 'Somewhere') RETURNING id", [ctx.familyId]);
  await photo();
  expect((await get(`/api/media/for?entity=visit:${visit}`)).json()).toMatchObject({ window: null, near: false, month: null, items: [] });
  expect((await get("/api/media/for?entity=document:00000000-0000-4000-8000-000000000000")).statusCode).toBe(400);
});

test("the first page of a big library is read from the timeline index, not by sorting everything", async () => {
  await query(
    `INSERT INTO media (family_id, immich_asset_id, kind, taken_at)
     SELECT $1, gen_random_uuid(), 'image', timestamptz '2010-01-01' + (g * interval '3 hours') FROM generate_series(1, 5000) g`,
    [ctx.familyId]);
  await query("ANALYZE media");
  const plan = (await query<{ "QUERY PLAN": string }>(
    `EXPLAIN SELECT m.id FROM media m WHERE m.family_id = $1 AND m.hidden_at IS NULL
      ORDER BY COALESCE(m.taken_at, m.created_at) DESC, m.id DESC LIMIT 60`, [ctx.familyId])).rows.map((r) => r["QUERY PLAN"]).join("\n");
  expect(plan).toMatch(/media_timeline/);
  expect(plan).not.toMatch(/Sort/);
});

test("a person's photos: ours, and another family's on a trip we share, tagged with them or their linked self", async () => {
  const smiths = await addUser(ctx, { familyName: "The Smiths", role: "owner" });
  const ourRose = await one("INSERT INTO people (family_id, display_name) VALUES ($1, 'Grandma Rose') RETURNING id", [ctx.familyId]);
  const theirRose = await one("INSERT INTO people (family_id, display_name) VALUES ($1, 'Rose') RETURNING id", [smiths.familyId]);
  await query("INSERT INTO person_links (person_a, person_b, status) VALUES ($1, $2, 'accepted')", [ourRose, theirRose]);
  const shared = await one("INSERT INTO trips (family_id, name) VALUES ($1, 'Tahoe') RETURNING id", [ctx.familyId]);
  await query("INSERT INTO trip_members (trip_id, family_id, role) VALUES ($1, $2, 'contributor')", [shared, smiths.familyId]);
  const tag = (familyId: string, media: string, person: string, role = "") =>
    query("INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role) VALUES ($1, 'media', $2, 'person', $3, $4)", [familyId, media, person, role]);

  const ours = await photo({ takenAt: "2025-07-01T10:00:00Z" });
  await tag(ctx.familyId, ours, ourRose, "face");
  const theirsShared = await photo({ familyId: smiths.familyId, tripId: shared, takenAt: "2025-07-02T10:00:00Z" });
  await tag(smiths.familyId, theirsShared, theirRose);
  const theirsPrivate = await photo({ familyId: smiths.familyId, takenAt: "2025-07-03T10:00:00Z" });
  await tag(smiths.familyId, theirsPrivate, theirRose);
  // Someone else's tag on our photo doesn't count (tags are the photo's own family's).
  const untagged = await photo({ takenAt: "2025-07-04T10:00:00Z" });
  await tag(smiths.familyId, untagged, theirRose);

  const ids = async (person: string, token = ctx.token) => (await get(`/api/media?person=${person}`, token)).json().items.map((m: Json) => m.id);
  expect(await ids(ourRose)).toEqual([theirsShared, ours]);
  expect(await ids(theirRose)).toEqual([theirsShared, ours]);
  // The Smiths see their own photos of her, not our photo that's on no shared trip.
  expect(await ids(theirRose, smiths.token)).toEqual([theirsPrivate, theirsShared]);
  expect((await get(`/api/media/timeline?person=${ourRose}`)).json().total).toBe(2);
});
