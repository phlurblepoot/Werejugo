import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { loadReferenceData } from "../db/reference.js";
import { findAirport, findPortDb, searchAirports, searchPorts } from "./places.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

describe("reference data", () => {
  test("the world's ports and airports are loaded, and an unchanged file isn't loaded again", async () => {
    const counts = (await query<{ ports: number; airports: number }>(
      "SELECT (SELECT count(*)::int FROM ports) AS ports, (SELECT count(*)::int FROM airports) AS airports",
    )).rows[0];
    expect(counts.ports).toBeGreaterThan(14_000);
    expect(counts.airports).toBeGreaterThan(8_500);
    expect(await loadReferenceData()).toEqual({ airports: "unchanged", ports: "unchanged" });
  });

  test("ports learned from CruiseMapper survive a reload", async () => {
    await query("INSERT INTO ports (name, country, lat, lng, source, search) VALUES ('Labadee', 'HT', 19.78, -72.25, 'cruisemapper', 'labadee')");
    try {
      const loaded = await loadReferenceData({ force: true });
      expect(loaded.ports).toBeGreaterThan(14_000);
      expect((await searchPorts("labad"))[0]).toMatchObject({ label: "Labadee, Haiti", lat: 19.78 });
    } finally {
      await query("DELETE FROM ports WHERE source = 'cruisemapper'");
    }
  });
});

describe("port search", () => {
  test("as you type, ignoring accents and case, cruise ports first", async () => {
    expect((await searchPorts("roatan"))[0].label).toBe("Roatán, Honduras");
    expect((await searchPorts("Juneau"))[0].label).toBe("Juneau, United States");
    expect((await searchPorts("cozum"))[0].label).toBe("Cozumel, Mexico");
    // An alias finds the port under its usual name.
    expect((await searchPorts("mahahual"))[0].label).toBe("Costa Maya, Mexico");
    expect((await searchPorts("miami"))[0].label).toBe("Miami, United States");
  });

  test("LIKE wildcards in the text are plain characters", async () => {
    expect(await searchPorts("%")).toEqual([]);
    expect(await searchPorts("_")).toEqual([]);
    expect(await findPortDb("%")).toBeNull();
  });

  test("a port named on CruiseMapper resolves to its coordinates, and nonsense to nothing", async () => {
    expect(await findPortDb("Cozumel")).toMatchObject({ label: "Cozumel", source: "port" });
    expect(await findPortDb("Skagway (Alaska)")).toMatchObject({ label: "Skagway" });
    expect(await findPortDb("Qwxzv Harbour")).toBeNull();
  });
});

describe("airport search", () => {
  test("a code finds its airport; a name or city finds the big airports first", async () => {
    expect((await searchAirports("lax"))[0].label).toBe("LAX — Los Angeles");
    expect((await searchAirports("heathrow"))[0].label).toBe("LHR — London");
    // Both of Chicago's big airports before its small ones.
    expect((await searchAirports("chicago")).slice(0, 2).map((a) => a.meta?.iata).sort()).toEqual(["MDW", "ORD"]);
    expect(await findAirport("KEF")).toMatchObject({ label: "Reykjavík (KEF)" });
    expect(await findAirport("zzz")).toBeNull();
  });
});
