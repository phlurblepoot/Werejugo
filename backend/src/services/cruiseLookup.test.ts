import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { startFakeWeb, type FakeWeb } from "../test/fake-web.js";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { findCruise, getSailingDetail, matchItinerary, searchCruiseLines, searchCruiseShips } from "./cruiseLookup.js";
import { searchPorts } from "./places.js";

let ctx: TestCtx;
let web: FakeWeb;
const before = { url: config.cruiseMapperUrl, on: config.cruiseLookupEnabled };
beforeAll(async () => {
  ctx = await buildTestApp();
  web = await startFakeWeb();
  config.cruiseMapperUrl = `${web.url}/cruisemapper`;
});
afterAll(async () => {
  Object.assign(config, { cruiseMapperUrl: before.url, cruiseLookupEnabled: before.on });
  await query("DELETE FROM ports WHERE source = 'cruisemapper'");
  await web.close();
  await closeTestApp(ctx);
});
beforeEach(async () => {
  web.calls.length = 0;
  web.down.clear();
  config.cruiseLookupEnabled = true;
  await query("TRUNCATE lookup_cache");
});

describe("CruiseMapper lookups", () => {
  test("cruise lines and a line's ships, asked for once", async () => {
    expect(await searchCruiseLines("royal")).toEqual([{ name: "Royal Caribbean", url: `${web.url}/cruisemapper/cruise-lines/Royal-Caribbean-1` }]);
    expect((await searchCruiseShips("sym", "Royal Caribbean")).map((s) => s.name)).toEqual(["Symphony of the Seas"]);
    expect((await searchCruiseShips("", "Royal Caribbean")).map((s) => s.name)).toEqual(["Symphony of the Seas", "Wonder of the Seas"]);
    await searchCruiseLines("carn");
    expect(web.calls).toEqual(["cruisemapper lines", "cruisemapper line Royal-Caribbean-1"]);
  });

  test("a ship's sailings and ports", async () => {
    const r = await findCruise({ line: "Royal Caribbean", ship: "Symphony of the Seas" });
    expect(r).toMatchObject({
      shipName: "Symphony of the Seas", lineName: "Royal Caribbean", warnings: [],
      image: `${web.url}/cruisemapper/images/ships/Symphony-of-the-Seas-1185.jpg`,
    });
    expect(r.sailings.map((s) => [s.id, s.dateISO, s.title])).toEqual([
      ["9001", "2026-11-07", "7 Night Eastern Caribbean"],
      ["9002", "2026-12-28", "7 Night Western Caribbean"],
    ]);
    expect(r.ports.map((p) => p.label)).toEqual(["Miami", "Labadee", "CocoCay", "Cozumel", "Roatan"]);
    // The same ship again: from the cache.
    web.calls.length = 0;
    await findCruise({ shipUrl: r.shipUrl! });
    expect(web.calls).toEqual([]);
  });

  test("a sailing over New Year: its ports on the right days, at the ship's local times, and its track", async () => {
    const d = await getSailingDetail("9002");
    expect(d.ports.map((p) => [p.label, p.kind, p.dateISO, p.arriveAt, p.departAt])).toEqual([
      ["Miami", "origin", "2026-12-28", null, "2026-12-28T16:30:00.000Z"],
      ["Cozumel", "port", "2026-12-31", "2026-12-31T08:00:00.000Z", "2026-12-31T18:00:00.000Z"],
      ["Roatan", "port", "2027-01-01", "2027-01-01T10:00:00.000Z", "2027-01-01T19:00:00.000Z"],
      ["Miami", "destination", "2027-01-04", "2027-01-04T06:00:00.000Z", null],
    ]);
    expect(d.path.length).toBe(7);
    expect(d.warnings).toEqual([]);
  });

  test("a sailing's ports are remembered, so private islands can be found by name later", async () => {
    const labadee = async () => (await searchPorts("labadee")).find((p) => p.label === "Labadee");
    expect(await labadee()).toBeUndefined();
    await getSailingDetail("9001");
    expect(await labadee()).toMatchObject({ lat: 19.7841 });
    expect((await searchPorts("labadee"))[0]).toMatchObject({ label: "Labadee", lat: 19.7841 });
    expect((await searchPorts("cococay"))[0]).toMatchObject({ label: "CocoCay" });
    expect((await searchPorts("little stirrup"))[0]).toMatchObject({ label: "CocoCay" });
    // Miami was already known: not added again.
    expect((await query("SELECT count(*)::int AS n FROM ports WHERE source = 'cruisemapper'")).rows[0].n).toBe(2);
    // And the sailing itself is kept.
    web.calls.length = 0;
    await getSailingDetail("9001");
    expect(web.calls).toEqual([]);
  });
});

describe("the cruise routes", () => {
  const post = (url: string, payload: object, token = ctx.token) => ctx.app.inject({ method: "POST", url, headers: bearer(token), payload });
  const get = (url: string) => ctx.app.inject({ method: "GET", url, headers: bearer(ctx.token) });

  test("turned off (CRUISE_LOOKUP_ENABLED=false): every cruise route says so", async () => {
    config.cruiseLookupEnabled = false;
    const answers = await Promise.all([
      get("/api/lookup/cruise/lines?q=roy"),
      get("/api/lookup/cruise/ships?q=sym&line=Royal%20Caribbean"),
      post("/api/lookup/cruise/find", { ship: "Symphony of the Seas" }),
      post("/api/lookup/cruise/sailing", { id: "9001" }),
      post("/api/lookup/cruise/diagnose", { query: "symphony" }),
    ]);
    for (const a of answers) {
      expect(a.statusCode).toBe(409);
      expect(a.json().error).toBe("Cruise lookup is turned off on this server. Add the ports yourself.");
    }
    expect(web.calls).toEqual([]);
  });

  test("CruiseMapper not answering: a 503 that says so, not kept", async () => {
    web.down.add("cruisemapper");
    const r = await post("/api/lookup/cruise/find", { line: "Royal Caribbean", ship: "Symphony of the Seas" });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: "CruiseMapper isn't answering right now. Try again in a few minutes, or add the ports yourself.", blocked: true });
    expect((await post("/api/lookup/cruise/sailing", { id: "9001" })).statusCode).toBe(503);
    web.down.clear();
    expect((await post("/api/lookup/cruise/find", { line: "Royal Caribbean", ship: "Symphony of the Seas" })).statusCode).toBe(200);
  });

  test("the diagnostic is for the server admin, and doesn't follow a redirect off CruiseMapper", async () => {
    const member = await addUser(ctx, { familyId: ctx.familyId });
    expect((await post("/api/lookup/cruise/diagnose", { query: "symphony" }, member.token)).statusCode).toBe(403);
    const ok = await post("/api/lookup/cruise/diagnose", { url: `${web.url}/cruisemapper/ships/Symphony-of-the-Seas-1185` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 200, looksBlocked: false, title: "Symphony of the Seas | CruiseMapper" });
    const away = await post("/api/lookup/cruise/diagnose", { url: `${web.url}/cruisemapper/elsewhere` });
    expect(away.json()).toEqual({ error: "Redirected away from CruiseMapper (to example.com)" });
    expect((await post("/api/lookup/cruise/diagnose", { url: "https://example.com/" })).json().error).toMatch(/^Only these hosts/);
  });

  test("bad input is a 400", async () => {
    expect((await post("/api/lookup/cruise/sailing", { id: "abc" })).statusCode).toBe(400);
    expect((await post("/api/lookup/cruise/find", {})).statusCode).toBe(400);
    expect((await post("/api/lookup/cruise/find", { shipUrl: "https://example.com/ships/x" })).json().warnings).toEqual([
      expect.stringMatching(/^Couldn't find/),
    ]);
  });
});

describe("past cruises: the same itinerary on another sailing", () => {
  const PORTS = [
    { name: "Miami", lng: -80.17, lat: 25.77 }, { name: "Cozumel", lng: -86.95, lat: 20.51 },
    { name: "Roatán", lng: -86.53, lat: 16.32 }, { name: "Costa Maya", lng: -87.69, lat: 18.73 },
    { name: "Miami", lng: -80.17, lat: 25.77 },
  ];

  test("the ports in the same order, on the ship or its sister ships, best first, with the days to move it by", async () => {
    const r = await matchItinerary({ line: "Royal Caribbean", ship: "Symphony of the Seas", ports: PORTS, date: "2025-03-16" });
    expect(r.matches.map((m) => [m.sailing.id, m.sailing.ship, m.score])).toEqual([
      ["9101", "Wonder of the Seas", 1],
      ["9002", "Symphony of the Seas", 0.8],
    ]);
    const best = r.matches[0];
    expect(best.shiftDays).toBe(-728); // 14 March 2027 → 16 March 2025
    expect(best.ports.map((p) => p.label)).toEqual(["Miami", "Cozumel", "Roatan", "Costa Maya", "Miami"]);
    expect(best.path.length).toBeGreaterThan(5);
  });

  test("the ship's own sailing is enough when it matches exactly (its sister ships aren't asked)", async () => {
    const own = [{ name: "Miami", lng: -80.17, lat: 25.77 }, { name: "Cozumel", lng: -86.95, lat: 20.51 }, { name: "Roatan", lng: -86.53, lat: 16.32 }, { name: "Miami", lng: -80.17, lat: 25.77 }];
    const r = await matchItinerary({ line: "Royal Caribbean", ship: "Symphony of the Seas", ports: own, date: "2024-12-29" });
    expect(r.matches[0]).toMatchObject({ score: 1, shiftDays: -729, sailing: { id: "9002" } }); // 28 Dec 2026 → 29 Dec 2024
    expect(web.calls.some((c) => c.includes("Wonder-of-the-Seas"))).toBe(false);
  });

  test("without ports: sailings of the same length from the same port, nearest in season first", async () => {
    const r = await matchItinerary({ ship: "Symphony of the Seas", line: "Royal Caribbean", departurePort: "Miami", nights: 7, date: "2025-11-10" });
    expect(r.matches.map((m) => m.sailing.id)).toEqual(["9001", "9002", "9101", "9102"]);
    expect(r.matches.every((m) => m.score < 1)).toBe(true);
  });

  test("the route, and nothing found", async () => {
    const res = await ctx.app.inject({
      method: "POST", url: "/api/lookup/cruise/match", headers: bearer(ctx.token),
      payload: { line: "Royal Caribbean", ship: "Symphony of the Seas", ports: PORTS, date: "2025-03-16" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().matches[0].sailing.id).toBe("9101");
    const none = await matchItinerary({ line: "Carnival Cruise Line", ship: "Carnival Breeze", ports: PORTS, date: "2025-03-16" });
    expect(none.matches).toEqual([]);
    expect(none.warnings).toEqual(["No sailing of Carnival Breeze or its sister ships goes to these ports. Build the route from the ports instead."]);
  });
});
