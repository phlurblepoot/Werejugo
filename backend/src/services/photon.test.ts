import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { startFakeWeb, type FakeWeb } from "../test/fake-web.js";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { geocode, searchPlaces } from "./places.js";

let ctx: TestCtx;
let web: FakeWeb;
const before = config.photonUrl;
beforeAll(async () => {
  ctx = await buildTestApp();
  web = await startFakeWeb();
  config.photonUrl = `${web.url}/photon`;
});
afterAll(async () => {
  config.photonUrl = before;
  await web.close();
  await closeTestApp(ctx);
});
beforeEach(async () => {
  web.calls.length = 0;
  web.down.clear();
  await query("TRUNCATE lookup_cache");
});

test("place search asks Photon, labels each place with where it is, and keeps the answer", async () => {
  const hits = await searchPlaces("colosseum");
  expect(hits).toEqual([{ label: "Colosseum, Rome, Lazio, Italy", lat: 41.8902, lng: 12.4924, source: "geocoder", meta: { type: "house", country: "IT" } }]);
  expect(await searchPlaces("Colosseum ")).toEqual(hits);
  expect(web.calls).toEqual(["photon q=colosseum"]);
});

test("near the map's centre, the nearer place comes first", async () => {
  const near = await searchPlaces("rome", { near: { lng: -84.4, lat: 33.7 } });
  expect(near[0].label).toBe("Rome, Georgia, United States");
  expect(web.calls).toEqual(["photon q=rome near=-84.400,33.700"]);
  const far = await searchPlaces("rome", { near: { lng: 12, lat: 42 } });
  expect(far[0].label).toBe("Rome, Lazio, Italy");
});

test("when Photon is down: nothing found, and the failure isn't kept", async () => {
  web.down.add("photon");
  expect(await searchPlaces("labadee")).toEqual([]);
  expect(await geocode("labadee")).toBeNull();
  web.down.clear();
  expect(await geocode("labadee")).toMatchObject({ label: "Labadee, Nord, Haiti", lat: 19.7841 });
});

test("the search route passes the map's centre along", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/geo/search?q=rome&near=-84.4,33.7", headers: { authorization: `Bearer ${ctx.token}` } });
  expect(res.statusCode).toBe(200);
  expect(res.json()[0].label).toBe("Rome, Georgia, United States");
  const bad = await ctx.app.inject({ method: "GET", url: "/api/geo/search?q=rome&near=nonsense", headers: { authorization: `Bearer ${ctx.token}` } });
  expect(bad.json()[0].label).toBe("Rome, Lazio, Italy");
});
