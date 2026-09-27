import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { startFakeWeb, type FakeWeb } from "../test/fake-web.js";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { roadPath, RoadRouteError } from "./roadRoute.js";

let ctx: TestCtx;
let web: FakeWeb;
const before = config.routingUrl;
beforeAll(async () => {
  ctx = await buildTestApp();
  web = await startFakeWeb();
  config.routingUrl = `${web.url}/osrm`;
});
afterAll(async () => {
  config.routingUrl = before;
  await web.close();
  await closeTestApp(ctx);
});
beforeEach(async () => {
  web.calls.length = 0;
  web.down.clear();
  await query("TRUNCATE lookup_cache");
});

const SF: [number, number] = [-122.4194, 37.7749];
const TAHOE: [number, number] = [-119.9772, 38.9399];
const TRUCKEE: [number, number] = [-120.1833, 39.328];

test("a drive follows the roads from the routing server, and is asked for once", async () => {
  const r = await roadPath([SF, TAHOE, TRUCKEE]);
  expect(r.path[0]).toEqual(SF);
  expect(r.path[r.path.length - 1]).toEqual(TRUCKEE);
  expect(r.path.length).toBe(5); // each leg bends through one point
  expect(r.distanceM).toBeGreaterThan(300_000);
  expect(await roadPath([SF, TAHOE, TRUCKEE])).toEqual(r);
  expect(web.calls).toEqual([`osrm ${SF.join(",")};${TAHOE.join(",")};${TRUCKEE.join(",")}`]);
});

test("no road between the stops, or the server down: an error that says which", async () => {
  await expect(roadPath([SF, [-25, 40]])).rejects.toThrow(new RoadRouteError("No road route between these stops."));
  web.down.add("osrm");
  await expect(roadPath([SF, TAHOE])).rejects.toThrow(new RoadRouteError("The road routing server isn't answering right now."));
  web.down.clear();
  // The failure wasn't kept.
  expect((await roadPath([SF, TAHOE])).path.length).toBe(3);
});

test("the route endpoints: road and sea, checked", async () => {
  const post = (url: string, payload: object) => ctx.app.inject({ method: "POST", url, headers: { authorization: `Bearer ${ctx.token}` }, payload });
  const road = await post("/api/routes/road", { points: [SF, TAHOE] });
  expect(road.statusCode).toBe(200);
  expect(road.json()).toMatchObject({ source: "road", path: expect.any(Array), distanceM: expect.any(Number) });

  web.down.add("osrm");
  const down = await post("/api/routes/road", { points: [SF, TRUCKEE] });
  expect(down.statusCode).toBe(503);
  expect(down.json().error).toBe("The road routing server isn't answering right now.");
  web.down.clear();

  const sea = await post("/api/routes/sea", { points: [[-80.17, 25.77], [-77.34, 25.08]] });
  expect(sea.statusCode).toBe(200);
  expect(sea.json()).toMatchObject({ source: "sea", path: expect.any(Array), distanceM: expect.any(Number) });

  for (const bad of [{ points: [SF] }, { points: [[200, 0], SF] }, { points: Array(61).fill(SF) }, {}]) {
    expect((await post("/api/routes/sea", bad)).statusCode).toBe(400);
  }
  const anon = await ctx.app.inject({ method: "POST", url: "/api/routes/sea", payload: { points: [SF, TAHOE] } });
  expect(anon.statusCode).toBe(401);
});
