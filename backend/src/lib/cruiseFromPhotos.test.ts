import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { planCruise, type PhotoPoint } from "./cruiseFromPhotos.js";

const MIAMI = { name: "Miami", lat: 25.7743, lng: -80.1799 };
const COZUMEL = { name: "Cozumel", lat: 20.508, lng: -86.946 };
const PLAYA = { name: "Playa del Carmen", lat: 20.625, lng: -87.07 };
const ROATAN = { name: "Roatán", lat: 16.3, lng: -86.55 };
const COSTA_MAYA = { name: "Costa Maya", lat: 18.729, lng: -87.69 };
const NASSAU = { name: "Nassau", lat: 25.079, lng: -77.338 };
const PORTS = [MIAMI, COZUMEL, PLAYA, ROATAN, COSTA_MAYA, NASSAU];

let n = 0;
const at = (day: string, hour: number) => Date.parse(`2024-03-${day}T${String(hour).padStart(2, "0")}:00:00Z`);
const ashore = (day: string, hour: number, lat: number, lng: number, country = "Mexico"): PhotoPoint => ({ id: `p${++n}`, t: at(day, hour), lat, lng, country });
const atSea = (day: string, hour: number, lat: number, lng: number): PhotoPoint => ({ id: `p${++n}`, t: at(day, hour), lat, lng, country: null });

/** A week's Western Caribbean cruise as someone's phone saw it. */
const WEEK: PhotoPoint[] = [
  ashore("03", 13, 25.776, -80.18, "United States"), // at the terminal
  ashore("03", 15, 25.77, -80.17, "United States"),
  atSea("03", 21, 25.1, -80.9),
  atSea("04", 10, 23.9, -83.4), atSea("04", 16, 22.4, -85.2),
  ashore("05", 8, 20.51, -86.95), // the pier
  ashore("05", 11, 20.214, -87.465), ashore("05", 12, 20.215, -87.46), // Tulum, on the mainland
  ashore("06", 9, 16.32, -86.53, "Honduras"), ashore("06", 14, 16.33, -86.52, "Honduras"),
  ashore("07", 10, 18.73, -87.69), ashore("07", 13, 18.74, -87.7),
  atSea("08", 11, 21.9, -84.6), atSea("08", 17, 23.5, -82.9),
  ashore("09", 8, 25.77, -80.18, "United States"),
];

describe("planning a cruise from photos", () => {
  test("port calls from the days ashore (the pier, not the excursion), sea days between, the trail through both", () => {
    const plan = planCruise(WEEK, PORTS)!;
    expect(plan.calls.map((c) => [c.label, c.dateISO, c.kind])).toEqual([
      ["Miami", "2024-03-03", "origin"],
      ["Cozumel", "2024-03-05", "port"],
      ["Roatán", "2024-03-06", "port"],
      ["Costa Maya", "2024-03-07", "port"],
      ["Miami", "2024-03-09", "destination"],
    ]);
    expect(plan.seaPhotos).toBe(5);
    // Ports and sea photos in time order; Tulum isn't on the trail.
    expect(plan.sequence).toEqual([
      [MIAMI.lng, MIAMI.lat], [-80.9, 25.1], [-83.4, 23.9], [-85.2, 22.4],
      [COZUMEL.lng, COZUMEL.lat], [ROATAN.lng, ROATAN.lat], [COSTA_MAYA.lng, COSTA_MAYA.lat],
      [-84.6, 21.9], [-82.9, 23.5], [MIAMI.lng, MIAMI.lat],
    ]);
    expect(plan.photoIds).toHaveLength(WEEK.length);
  });

  test("sea photos close together count once on the trail", () => {
    const burst = [
      ashore("03", 14, 25.77, -80.17, "United States"),
      atSea("03", 20, 25.1, -80.9), { ...atSea("03", 20, 25.1, -80.91), t: at("03", 20) + 600_000 },
      atSea("04", 12, 24.5, -79.0),
      ashore("05", 9, 25.08, -77.34, "Bahamas"),
    ];
    const plan = planCruise(burst, PORTS)!;
    expect(plan.sequence).toHaveLength(4);
    expect(plan.calls.map((c) => c.label)).toEqual(["Miami", "Nassau"]);
  });

  test("a trip with no photos at sea, or only one port, isn't a cruise", () => {
    const onLand = WEEK.filter((p) => p.country);
    expect(planCruise(onLand.slice(0, 2), PORTS)).toBeNull(); // one port, no sea
    const oneSea = [ashore("03", 14, 25.77, -80.17, "United States"), atSea("04", 10, 23.9, -83.4)];
    expect(planCruise(oneSea, PORTS)).toBeNull();
  });
});

describe("POST /api/cruises/from-photos", () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await buildTestApp();
    for (const p of WEEK) {
      await query(
        `INSERT INTO media (family_id, immich_asset_id, kind, taken_at, geom, country)
         VALUES ($1, gen_random_uuid(), 'image', $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5)`,
        [ctx.familyId, new Date(p.t).toISOString(), p.lng, p.lat, p.country],
      );
    }
  });
  afterAll(async () => { await closeTestApp(ctx); });
  const post = (payload: object, token = ctx.token) => ctx.app.inject({ method: "POST", url: "/api/cruises/from-photos", headers: bearer(token), payload });

  test("proposes the ports, a trail on water, and the photos it used", async () => {
    const res = await post({ from: "2024-03-03", to: "2024-03-09" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Roatán's port town is Coxen Hole in the World Port Index: the nearest port is the one named.
    const roatan = (label: string) => ["Coxen Hole", "Roatán", "Mahogany Bay"].includes(label) ? "(Roatán)" : label;
    expect(body.ports.map((p: { label: string; kind: string; arriveAt: string | null; departAt: string | null }) => [roatan(p.label), p.kind, p.arriveAt, p.departAt])).toEqual([
      ["Miami", "origin", null, "2024-03-03T00:00:00.000Z"],
      ["Cozumel", "port", "2024-03-05T00:00:00.000Z", null],
      ["(Roatán)", "port", "2024-03-06T00:00:00.000Z", null],
      ["Costa Maya", "port", "2024-03-07T00:00:00.000Z", null],
      ["Miami", "destination", "2024-03-09T00:00:00.000Z", null],
    ]);
    expect(body.path.length).toBeGreaterThan(10);
    expect(body.distanceM).toBeGreaterThan(2_500_000);
    expect(body.photoIds).toHaveLength(WEEK.length);
    expect(body.seaPhotos).toBe(5);
  });

  test("not enough to go on: says why; another family's photos aren't used; bad dates are a 400", async () => {
    const few = await post({ from: "2024-03-05", to: "2024-03-05" });
    expect(few.statusCode).toBe(422);
    expect(few.json().error).toBe("Not enough photos with a location from those days to build the cruise (it needs two ports, or photos at sea on two days).");
    const other = await addUser(ctx);
    expect((await post({ from: "2024-03-03", to: "2024-03-09" }, other.token)).statusCode).toBe(422);
    expect((await post({ from: "2024-03-09", to: "2024-03-03" })).statusCode).toBe(400);
    expect((await post({ from: "2024-01-01", to: "2024-06-30" })).statusCode).toBe(400);
  });
});
