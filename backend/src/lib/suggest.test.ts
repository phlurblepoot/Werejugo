import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { query } from "../db/pool.js";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx, type TestUser } from "../test/helpers.js";
import { cityName, forLibrary, forTrip, forVisit, inferHome } from "./suggest.js";
import type { Scope } from "./access.js";

let ctx: TestCtx;
let smiths: TestUser;
let scope: Scope;
beforeAll(async () => {
  ctx = await buildTestApp();
  smiths = await addUser(ctx, { familyName: "The Smiths", role: "owner" });
  scope = { userId: ctx.userId, familyId: ctx.familyId, role: "owner", isAdmin: true };
});
afterAll(async () => { await closeTestApp(ctx); });
afterEach(async () => {
  for (const t of ["suggestion_dismissals", "links", "media", "visits", "people", "trip_members", "trip_albums", "trips"]) await query(`DELETE FROM ${t}`);
});

type Json = Record<string, any>;
const one = async (sql: string, params: unknown[]) => (await query<{ id: string }>(sql, params)).rows[0].id;
const HOME = { lat: 39.1, lng: -120.0 }; // near Lake Tahoe
const LISBON = { lat: 38.7223, lng: -9.1393 };
const PORTO = { lat: 41.1579, lng: -8.6291 };
const FLORENCE = { lat: 43.7696, lng: 11.2558 };
const ROME = { lat: 41.9028, lng: 12.4964 };

async function photo(o: { at: string; where?: { lat: number; lng: number } | null; city?: string; country?: string; trip?: string; hidden?: boolean; familyId?: string; createdAt?: string }) {
  return one(
    `INSERT INTO media (family_id, immich_asset_id, kind, taken_at, geom, city, country, trip_id, hidden_at, created_at)
     VALUES ($1, gen_random_uuid(), 'image', $2,
             CASE WHEN $3::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($4, $3), 4326) END, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))
     RETURNING id`,
    [o.familyId ?? ctx.familyId, o.at, o.where?.lat ?? null, o.where?.lng ?? null, o.city ?? null, o.country ?? null, o.trip ?? null,
      o.hidden ? new Date() : null, o.createdAt ?? null]);
}
/** n photos at a place, one every `stepH` hours from `start`. */
async function series(n: number, start: string, where: { lat: number; lng: number } | null, extra: Partial<Parameters<typeof photo>[0]> = {}, stepH = 6) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const jitter = where ? { lat: where.lat + (i % 3) * 0.0005, lng: where.lng + (i % 2) * 0.0005 } : null;
    ids.push(await photo({ at: new Date(Date.parse(start) + i * stepH * 3600_000).toISOString(), where: jitter, ...extra }));
  }
  return ids;
}
const trip = (name: string, start: string | null, end: string | null, familyId = ctx.familyId) =>
  one("INSERT INTO trips (family_id, name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id", [familyId, name, start, end]);
const place = (tripId: string | null, title: string, at: { lat: number; lng: number }, on: string | null = null, familyId = ctx.familyId) =>
  one(`INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, geom) VALUES ($1, $2, 'place', $3, $4, ST_SetSRID(ST_MakePoint($6, $5), 4326)) RETURNING id`,
    [familyId, tripId, title, on, at.lat, at.lng]);
/** A home: photos near Tahoe on many days. */
const homeLife = () => series(12, "2018-01-01T12:00:00Z", HOME, { city: "South Lake Tahoe" }, 24 * 20);
const post = (url: string, payload: object, token = ctx.token) => ctx.app.inject({ method: "POST", url, headers: bearer(token), payload });
const get = (url: string, token = ctx.token) => ctx.app.inject({ method: "GET", url, headers: bearer(token) });

test("a home is where photos were taken on the most days; a small library has none", () => {
  const at = (d: number, p: { lat: number; lng: number }) => ({ t: Date.parse("2020-01-01") + d * 86_400_000, ...p });
  const pts = [...Array.from({ length: 6 }, (_, i) => at(i * 10, HOME)), ...Array.from({ length: 30 }, (_, i) => at(100, LISBON)), at(101, LISBON)];
  const home = inferHome(pts)!;
  expect(home.lat).toBeCloseTo(HOME.lat, 3);
  expect(inferHome(pts.slice(0, 4))).toBeNull();
});

test("district names from GeoNames read as their city", () => {
  expect(["Paris 16 Passy", "Lyon 03", "Marseille 08", "Rome", "Porto", "Saint-Denis"].map(cityName))
    .toEqual(["Paris", "Lyon", "Marseille", "Rome", "Porto", "Saint-Denis"]);
  expect(cityName(null)).toBeNull();
});

test("the library: runs of photos away from home, in no trip, become trips to make", async () => {
  await homeLife();
  const lisbon = await series(10, "2019-03-03T09:00:00Z", LISBON, { city: "Lisbon", country: "Portugal" });
  const porto = await series(4, "2019-03-06T10:00:00Z", PORTO, { city: "Porto", country: "Portugal" });
  // No location, taken during the Lisbon week: counted too.
  const unplaced = await photo({ at: "2019-03-05T12:00:00Z" });
  // A weekend somewhere with only a country, a year later.
  await series(6, "2020-07-10T09:00:00Z", ROME, { country: "Italy" }, 4);
  // Too few photos; and a trip's own dates (those photos are that trip's suggestion).
  await series(3, "2021-05-01T09:00:00Z", FLORENCE);
  await trip("Florence 2022", "2022-05-01", "2022-05-03");
  await series(8, "2022-05-02T09:00:00Z", FLORENCE, { city: "Florence" });

  const found = await forLibrary(scope);
  expect(found.map((s) => s.name)).toEqual(["Italy, July 2020", "Lisbon and Porto, March 2019"]);
  const lp = found[1];
  expect(lp).toMatchObject({ kind: "new-trip", startDate: "2019-03-03", endDate: "2019-03-07", label: "Lisbon and Porto", count: 15 });
  expect(lp.mediaIds).toEqual(expect.arrayContaining([...lisbon, ...porto, unplaced]));
  expect(lp.thumbUrls).toHaveLength(4);
  expect(lp.key).toMatch(/^new-trip:2019-03-03:2019-03-07:39\.\d,-9\.\d$/);

  // Making it: the trip, with its photos; it's no longer suggested.
  const made = (await post("/api/suggestions/apply", { key: lp.key })).json();
  expect(made).toMatchObject({ attached: 15 });
  const t = (await query("SELECT name, start_date::text AS s, end_date::text AS e, status FROM trips WHERE id = $1", [made.tripId])).rows[0];
  expect(t).toEqual({ name: "Lisbon and Porto, March 2019", s: "2019-03-03", e: "2019-03-07", status: "done" });
  expect((await query("SELECT count(*)::int AS n FROM media WHERE trip_id = $1", [made.tripId])).rows[0].n).toBe(15);
  expect((await forLibrary(scope)).map((s) => s.name)).toEqual(["Italy, July 2020"]);

  // A given name; dismissing.
  const italy = (await forLibrary(scope))[0];
  expect((await post("/api/suggestions/dismiss", { key: italy.key })).statusCode).toBe(204);
  expect(await forLibrary(scope)).toEqual([]);
});

test("the library: a run of photos with some at sea (no place name) and days in port is a cruise to make", async () => {
  await homeLife();
  const at = (d: string, h: number) => `2023-03-${d}T${String(h).padStart(2, "0")}:00:00Z`;
  const ids = [
    await photo({ at: at("03", 14), where: { lat: 25.776, lng: -80.18 }, city: "Miami", country: "United States" }),
    await photo({ at: at("03", 21), where: { lat: 25.1, lng: -80.9 } }),
    await photo({ at: at("04", 10), where: { lat: 23.9, lng: -83.4 } }),
    await photo({ at: at("04", 16), where: { lat: 22.4, lng: -85.2 } }),
    await photo({ at: at("05", 9), where: { lat: 20.51, lng: -86.95 }, city: "Cozumel", country: "Mexico" }),
    await photo({ at: at("05", 12), where: { lat: 20.214, lng: -87.465 }, city: "Tulum", country: "Mexico" }),
    await photo({ at: at("07", 10), where: { lat: 18.73, lng: -87.69 }, city: "Mahahual", country: "Mexico" }),
    await photo({ at: at("08", 12), where: { lat: 21.9, lng: -84.6 } }),
    await photo({ at: at("09", 8), where: { lat: 25.77, lng: -80.18 }, city: "Miami", country: "United States" }),
  ];
  const [cruise] = await forLibrary(scope);
  expect(cruise).toMatchObject({
    kind: "new-cruise", startDate: "2023-03-03", endDate: "2023-03-09", count: 9,
    stops: ["Miami", "Cozumel", "Costa Maya", "Miami"], name: "Cruise from Miami, March 2023",
  });
  expect(cruise.key).toMatch(/^new-cruise:2023-03-03:2023-03-09:/);

  // Making it: the trip with its photos, and the cruise on it, its ports and a trail from the photos.
  const made = (await post("/api/suggestions/apply", { key: cruise.key })).json();
  expect(made).toMatchObject({ attached: 9, visitId: expect.any(String), tripId: expect.any(String) });
  expect((await query("SELECT count(*)::int AS n FROM media WHERE trip_id = $1", [made.tripId])).rows[0].n).toBe(9);
  const v = (await get(`/api/visits/${made.visitId}`)).json();
  expect(v).toMatchObject({ kind: "cruise", tripId: made.tripId, title: "Miami → Cozumel → Costa Maya → Miami", occurredOn: "2023-03-03", occurredEnd: "2023-03-09" });
  expect(v.waypoints.map((w: Json) => [w.label, w.kind])).toEqual([["Miami", "origin"], ["Cozumel", "port"], ["Costa Maya", "port"], ["Miami", "destination"]]);
  expect(v.geometry.type).toBe("LineString");
  expect(v.properties.route).toEqual({ source: "photos", distanceM: expect.any(Number) });
  expect(ids).toHaveLength(9);
  expect(await forLibrary(scope)).toEqual([]);
});

test("the library with no clear home: everywhere counts, still split by gaps", async () => {
  await series(6, "2019-03-03T09:00:00Z", LISBON, { city: "Lisbon" });
  await series(6, "2019-03-20T09:00:00Z", LISBON, { city: "Lisbon" });
  expect((await forLibrary(scope)).map((s) => [s.startDate, s.count])).toEqual([["2019-03-20", 6], ["2019-03-03", 6]]);
});

test("a trip's photos: mine, in no trip, during its dates, away from home or near its places (or with no location)", async () => {
  await homeLife();
  const italy = await trip("Italy 2024", "2024-06-03", "2024-06-10");
  await place(italy, "Colosseum", ROME);
  const near = await series(3, "2024-06-04T09:00:00Z", { lat: ROME.lat + 0.1, lng: ROME.lng });
  const noPlace = await photo({ at: "2024-06-11T20:00:00Z" }); // the day after counts
  const florence = await photo({ at: "2024-06-05T09:00:00Z", where: FLORENCE }); // far from its places, but away from home
  await photo({ at: "2024-06-05T09:00:00Z", where: HOME }); // someone at home meanwhile
  await photo({ at: "2024-06-20T09:00:00Z", where: ROME }); // after
  await photo({ at: "2024-06-05T09:00:00Z", where: ROME, hidden: true });
  await photo({ at: "2024-06-05T09:00:00Z", where: ROME, trip: await trip("Other", null, null) });
  await photo({ at: "2024-06-05T09:00:00Z", where: ROME, familyId: smiths.familyId });

  const s = (await forTrip(scope, italy)).find((x) => x.kind === "trip-photos")!;
  expect(s.mediaIds.sort()).toEqual([...near, noPlace, florence].sort());
  expect(s.count).toBe(5);

  // Dismissed: only photos added since bring it back.
  await post("/api/suggestions/dismiss", { key: s.key });
  expect((await forTrip(scope, italy)).find((x) => x.kind === "trip-photos")).toBeUndefined();
  const later = await photo({ at: "2024-06-06T09:00:00Z", where: ROME, createdAt: new Date(Date.now() + 60_000).toISOString() });
  expect((await forTrip(scope, italy)).find((x) => x.kind === "trip-photos")!.mediaIds).toEqual([later]);

  // Applying puts them in the trip.
  const r = (await post("/api/suggestions/apply", { key: s.key })).json();
  expect(r).toMatchObject({ tripId: italy, attached: 1 });
  expect((await query("SELECT trip_id FROM media WHERE id = $1", [later])).rows[0].trip_id).toBe(italy);
});

test("with no clear home, a trip takes photos from its dates wherever they were", async () => {
  const t = await trip("Road trip", "2023-08-01", "2023-08-02");
  await photo({ at: "2023-08-01T10:00:00Z", where: LISBON });
  await photo({ at: "2023-08-02T10:00:00Z", where: HOME });
  expect((await forTrip(scope, t)).find((x) => x.kind === "trip-photos")?.count).toBe(2);
});

test("places missing from a trip: spots with 3+ of its photos, more than 1 km from its places", async () => {
  const italy = await trip("Italy 2024", "2024-06-03", "2024-06-10");
  await place(italy, "Colosseum", ROME);
  await series(5, "2024-06-04T09:00:00Z", ROME, { trip: italy, city: "Rome" }, 1); // at the Colosseum: known
  const florence = await series(4, "2024-06-06T09:00:00Z", FLORENCE, { trip: italy, city: "Florence 02 Centro" }, 1);
  await series(2, "2024-06-07T09:00:00Z", { lat: 43.3188, lng: 11.3308 }, { trip: italy, city: "Siena" }, 1); // too few

  const spots = (await forTrip(scope, italy)).filter((x) => x.kind === "trip-place");
  expect(spots).toHaveLength(1);
  expect(spots[0]).toMatchObject({ label: "Florence", count: 4, startDate: "2024-06-06" });
  expect(spots[0].key).toMatch(/^trip-place:[-0-9a-f]+:43\.77\d,11\.25\d$/);

  const r = (await post("/api/suggestions/apply", { key: spots[0].key, name: "Uffizi" })).json();
  expect(r).toMatchObject({ tripId: italy, attached: 4 });
  const v = (await query("SELECT title, trip_id, occurred_on::text AS on FROM visits WHERE id = $1", [r.visitId])).rows[0];
  expect(v).toEqual({ title: "Uffizi", trip_id: italy, on: "2024-06-06" });
  expect((await query("SELECT count(*)::int AS n FROM links WHERE to_id = $1 AND from_id = ANY($2::uuid[])", [r.visitId, florence])).rows[0].n).toBe(4);
  expect((await forTrip(scope, italy)).filter((x) => x.kind === "trip-place")).toEqual([]);
});

test("people in a trip's photos, tagged by face or by hand, not yet on the trip", async () => {
  const italy = await trip("Italy 2024", "2024-06-03", "2024-06-10");
  const grandma = await one("INSERT INTO people (family_id, display_name) VALUES ($1, 'Grandma') RETURNING id", [ctx.familyId]);
  const mia = await one("INSERT INTO people (family_id, display_name) VALUES ($1, 'Mia') RETURNING id", [ctx.familyId]);
  const once = await one("INSERT INTO people (family_id, display_name) VALUES ($1, 'Once') RETURNING id", [ctx.familyId]);
  const shots = await series(4, "2024-06-04T09:00:00Z", ROME, { trip: italy });
  const tag = (m: string, p: string, role = "") => query("INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role) VALUES ($1, 'media', $2, 'person', $3, $4)", [ctx.familyId, m, p, role]);
  for (const m of shots) await tag(m, grandma, "face");
  await tag(shots[0], mia); await tag(shots[1], mia, "face");
  await tag(shots[0], once);
  await query("INSERT INTO links (family_id, from_type, from_id, to_type, to_id) VALUES ($1, 'person', $2, 'trip', $3)", [ctx.familyId, mia, italy]);

  const people = (await forTrip(scope, italy)).filter((x) => x.kind === "trip-person");
  expect(people.map((p) => [p.person!.displayName, p.count])).toEqual([["Grandma", 4]]);
  await post("/api/suggestions/apply", { key: people[0].key });
  expect((await query("SELECT count(*)::int AS n FROM links WHERE from_id = $1 AND to_id = $2", [grandma, italy])).rows[0].n).toBe(1);
  expect((await forTrip(scope, italy)).filter((x) => x.kind === "trip-person")).toEqual([]);
});

test("a place's photos: within 2 km, on its dates, not already linked or in another trip", async () => {
  const t = await trip("Italy", "2024-06-03", "2024-06-10");
  const v = await place(t, "Colosseum", ROME, "2024-06-04");
  const here = await series(3, "2024-06-04T09:00:00Z", { lat: ROME.lat + 0.01, lng: ROME.lng });
  await photo({ at: "2024-06-04T09:00:00Z", where: FLORENCE });
  await photo({ at: "2024-06-09T09:00:00Z", where: ROME });
  await photo({ at: "2024-06-04T10:00:00Z", where: ROME, trip: await trip("Other", null, null) });
  const s = (await forVisit(scope, v))[0];
  expect(s.mediaIds.sort()).toEqual([...here].sort());
  expect((await post("/api/suggestions/apply", { key: s.key })).json()).toMatchObject({ visitId: v, attached: 3 });
  // Linked to the place, and in its trip.
  expect((await query("SELECT count(*)::int AS n FROM media WHERE id = ANY($1::uuid[]) AND trip_id = $2", [here, t])).rows[0].n).toBe(3);
  expect(await forVisit(scope, v)).toEqual([]);
  // A place with no date or location suggests nothing.
  expect(await forVisit(scope, await place(null, "Somewhere", ROME))).toEqual([]);
});

test("the routes: what the browser gets, and refusals", async () => {
  const italy = await trip("Italy 2024", "2024-06-03", "2024-06-10");
  await series(2, "2024-06-04T09:00:00Z", ROME);
  const res = (await get(`/api/suggestions?for=trip:${italy}`)).json();
  expect(res.items).toHaveLength(1);
  expect(res.items[0]).toMatchObject({ kind: "trip-photos", count: 2, tripId: italy });
  expect(res.items[0].mediaIds).toBeUndefined();
  expect(res.items[0].thumbUrls[0]).toMatch(/^\/api\/m\/[-0-9a-f]+\/thumbnail\?e=/);

  expect((await get("/api/suggestions?for=library")).json()).toEqual({ items: [] });
  expect((await get("/api/suggestions?for=nope")).statusCode).toBe(400);
  expect((await get("/api/suggestions?for=trip:not-a-uuid")).statusCode).toBe(400);
  expect((await post("/api/suggestions/apply", { key: "rm -rf" })).statusCode).toBe(400);
  // Gone since (someone else applied it): says so.
  await query("UPDATE media SET trip_id = $1", [italy]);
  const gone = await post("/api/suggestions/apply", { key: res.items[0].key });
  expect(gone.statusCode).toBe(404);
  expect(gone.json().error).toMatch(/changed/);
});

test("another family's trip or place: 404, and my photos never go into suggestions for them", async () => {
  const theirs = await trip("Their trip", "2024-06-03", "2024-06-10", smiths.familyId);
  const theirPlace = await place(theirs, "Their place", ROME, "2024-06-04", smiths.familyId);
  await series(2, "2024-06-04T09:00:00Z", ROME);
  expect((await get(`/api/suggestions?for=trip:${theirs}`)).statusCode).toBe(404);
  expect((await get(`/api/suggestions?for=visit:${theirPlace}`)).statusCode).toBe(404);
  expect((await post("/api/suggestions/apply", { key: `trip-photos:${theirs}` })).statusCode).toBe(404);
  expect((await post("/api/suggestions/dismiss", { key: `trip-photos:${theirs}` })).statusCode).toBe(404);
  // Once we share the trip, my photos can go in it (as a contributor's do).
  await query("INSERT INTO trip_members (trip_id, family_id, role) VALUES ($1, $2, 'contributor')", [theirs, ctx.familyId]);
  const s = (await get(`/api/suggestions?for=trip:${theirs}`)).json().items as Json[];
  expect(s.map((x) => [x.kind, x.count])).toEqual([["trip-photos", 2]]);
  // …but their photos are never in my suggestions.
  await series(2, "2024-06-04T09:00:00Z", ROME, { familyId: smiths.familyId });
  expect((await get(`/api/suggestions?for=trip:${theirs}`)).json().items[0].count).toBe(2);
});
