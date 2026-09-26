import { afterAll, beforeAll, expect, test } from "vitest";
import FormData from "form-data";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

async function importFile(name: string, body: string, tripId?: string) {
  const form = new FormData();
  if (tripId) form.append("tripId", tripId);
  form.append("file", Buffer.from(body), { filename: name });
  return ctx.app.inject({
    method: "POST", url: "/api/import",
    headers: { authorization: `Bearer ${ctx.token}`, ...form.getHeaders() }, payload: form.getBuffer(),
  });
}

const gpx = (segments: string) =>
  `<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Hike</name>${segments}</trk></gpx>`;
const seg = (pts: Array<[number, number, number]>) =>
  `<trkseg>${pts.map(([lat, lon, ele]) => `<trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele></trkpt>`).join("")}</trkseg>`;

test("a GPX track with elevation imports as a 2D drive", async () => {
  const res = await importFile("hike.gpx", gpx(seg([[34.24, -116.91, 2050], [34.25, -116.9, 2100]])));
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ imported: 1, skipped: 0 });
  const g = (await query<{ t: string; dims: number }>(
    "SELECT ST_GeometryType(geom) AS t, ST_NDims(geom) AS dims FROM visits WHERE title = 'Hike'")).rows[0];
  expect(g).toEqual({ t: "ST_LineString", dims: 2 });
});

test("a multi-segment track keeps every segment's points in one drive", async () => {
  await query("DELETE FROM visits");
  const res = await importFile("two.gpx", gpx(
    seg([[34.0, -117.0, 10], [34.1, -117.1, 20]]) + seg([[34.2, -117.2, 30], [34.3, -117.3, 40], [34.4, -117.4, 50]])));
  expect(res.json()).toMatchObject({ imported: 1 });
  const n = (await query<{ n: number }>("SELECT ST_NPoints(geom) AS n FROM visits")).rows[0].n;
  expect(n).toBe(5);
});

test("unsupported geometries are counted as skipped, not fatal", async () => {
  const geojson = JSON.stringify({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { name: "Lake" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      { type: "Feature", properties: { name: "Cafe" }, geometry: { type: "Point", coordinates: [2.35, 48.85, 35] } },
    ],
  });
  const res = await importFile("mixed.geojson", geojson);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ imported: 1, skipped: 1, truncated: 0 });
});

test("features with broken coordinates are skipped instead of failing the whole import", async () => {
  const geojson = JSON.stringify({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { name: "Nowhere" }, geometry: { type: "Point", coordinates: [999, 999] } },
      { type: "Feature", properties: { name: "Garbled" }, geometry: { type: "LineString", coordinates: "oops" } },
      { type: "Feature", properties: { name: "Fine" }, geometry: { type: "Point", coordinates: [2.35, 48.85] } },
    ],
  });
  const res = await importFile("broken.geojson", geojson);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ imported: 1, skipped: 2 });
});

test("an import can go straight onto a trip — but only one the family may use", async () => {
  const trip = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1, 'Road trip') RETURNING id", [ctx.familyId])).rows[0].id;
  const geojson = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Motel" }, geometry: { type: "Point", coordinates: [-110, 36] } }] });
  expect((await importFile("stops.geojson", geojson, trip)).json()).toMatchObject({ imported: 1 });
  const row = (await query<{ trip_id: string }>("SELECT trip_id FROM visits WHERE title = 'Motel'")).rows[0];
  expect(row.trip_id).toBe(trip);
  const other = (await query<{ id: string }>("INSERT INTO families (name) VALUES ('Others') RETURNING id")).rows[0].id;
  const theirs = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1, 'Theirs') RETURNING id", [other])).rows[0].id;
  expect((await importFile("stops.geojson", geojson, theirs)).statusCode).toBe(400);
});
