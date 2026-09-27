import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { startFakeWeb, type FakeWeb } from "../test/fake-web.js";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { lookupFlightByNumber } from "./flightLookup.js";

let ctx: TestCtx;
let web: FakeWeb;
const before = { url: config.aerodataboxUrl, key: config.aerodataboxKey };
beforeAll(async () => {
  ctx = await buildTestApp();
  web = await startFakeWeb();
  Object.assign(config, { aerodataboxUrl: `${web.url}/aerodatabox`, aerodataboxKey: "test-key" });
});
afterAll(async () => {
  Object.assign(config, { aerodataboxUrl: before.url, aerodataboxKey: before.key });
  await web.close();
  await closeTestApp(ctx);
});
beforeEach(async () => {
  web.calls.length = 0;
  await query("TRUNCATE lookup_cache");
});

test("a flight number with two legs: every airport in order, local times, and its date", async () => {
  const r = await lookupFlightByNumber("wn1234", "2026-10-01");
  expect(r.title).toBe("Southwest WN1234 (MDW → DEN → PHX)");
  expect(r.date).toBe("2026-10-01");
  expect(r.waypoints.map((w) => [w.label, w.kind, w.departAt ?? null, w.arriveAt ?? null])).toEqual([
    ["Chicago (MDW)", "origin", "2026-10-01T09:05:00.000Z", null],
    ["Denver (DEN)", "stop", "2026-10-01T12:40:00.000Z", "2026-10-01T10:40:00.000Z"],
    ["Phoenix (PHX)", "destination", null, "2026-10-01T13:55:00.000Z"],
  ]);
  expect(r.path.length).toBeGreaterThan(90);
  expect(r.warnings).toEqual([]);
  // Asked once.
  await lookupFlightByNumber("WN1234", "2026-10-01");
  expect(web.calls).toEqual(["aerodatabox WN1234 2026-10-01"]);
});

test("an overnight flight lands the next day", async () => {
  const r = await lookupFlightByNumber("BA178", "2025-05-01");
  expect(r.waypoints.map((w) => [w.label, w.departAt ?? w.arriveAt])).toEqual([
    ["New York (JFK)", "2025-05-01T21:30:00.000Z"],
    ["London (LHR)", "2025-05-02T09:35:00.000Z"],
  ]);
});

test("no such flight, a date it can't answer, no key: each says so", async () => {
  expect((await lookupFlightByNumber("ZZ999", "2026-10-01")).warnings).toEqual(["No flight ZZ999 found on 2026-10-01. Check the number and the date (the day it left, where it left from)."]);
  expect((await lookupFlightByNumber("BA178", "2012-05-01")).warnings).toEqual(["AeroDataBox can't look up flights on 2012-05-01 (it covers about a year either side of today). Pick the airports instead."]);
  config.aerodataboxKey = "";
  expect((await lookupFlightByNumber("BA178", "2025-05-01")).warnings[0]).toMatch(/^Flight-number lookup isn't set up/);
  config.aerodataboxKey = "test-key";
});

test("the route checks the number and the date", async () => {
  const post = (payload: object) => ctx.app.inject({ method: "POST", url: "/api/lookup/flight", headers: bearer(ctx.token), payload });
  expect((await post({ flightNumber: "WN1234", date: "2026-10-01" })).json().waypoints).toHaveLength(3);
  expect((await post({ flightNumber: "WN1234", date: "October 1st" })).statusCode).toBe(400);
  expect((await post({ flightNumber: "!!", date: "2026-10-01" })).statusCode).toBe(400);
});
