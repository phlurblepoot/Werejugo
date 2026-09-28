import { describe, expect, test } from "vitest";
import { isWaterAt, seaPath } from "./seaRoute.js";

type P = [number, number];
const MIAMI: P = [-80.17, 25.77];
const COZUMEL: P = [-86.95, 20.51];
const ROATAN: P = [-86.55, 16.32];
const COSTA_MAYA: P = [-87.69, 18.73];
const SEATTLE: P = [-122.34, 47.6];
const JUNEAU: P = [-134.41, 58.3];
const ISTANBUL: P = [28.98, 41.01];
const ODESSA: P = [30.73, 46.48];
const HONOLULU: P = [-157.86, 21.3];
const TOKYO: P = [139.77, 35.62];

const km = (a: number[], b: number[]) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/**
 * Points along the path, every ~2 km, that are on land, other than within `slack`
 * km of a port (a port's own spot can be on land at the grid's 5 km scale).
 */
function landCrossings(path: number[][], ports: number[][], slack = 12): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const n = Math.max(1, Math.ceil(km(path[i], path[i + 1]) / 2));
    for (let s = 0; s <= n; s++) {
      const p = [path[i][0] + ((path[i + 1][0] - path[i][0]) * s) / n, path[i][1] + ((path[i + 1][1] - path[i][1]) * s) / n];
      if (ports.some((q) => km(p, q) < slack)) continue;
      if (!isWaterAt(p[0], p[1])) out.push(p);
    }
  }
  return out;
}

describe("sea routes", () => {
  test("a Caribbean cruise stays on water and reaches every port", async () => {
    const r = await seaPath([MIAMI, COZUMEL, ROATAN, COSTA_MAYA, MIAMI]);
    expect(r.path[0]).toEqual(MIAMI);
    expect(r.path[r.path.length - 1]).toEqual(MIAMI);
    for (const port of [COZUMEL, ROATAN, COSTA_MAYA]) expect(r.path.some((p) => km(p, port) < 0.01)).toBe(true);
    expect(landCrossings(r.path, [MIAMI, COZUMEL, ROATAN, COSTA_MAYA])).toEqual([]);
    const direct = km(MIAMI, COZUMEL) + km(COZUMEL, ROATAN) + km(ROATAN, COSTA_MAYA) + km(COSTA_MAYA, MIAMI);
    expect(r.distanceM / 1000).toBeGreaterThan(direct);
    expect(r.distanceM / 1000).toBeLessThan(direct * 1.35);
  });

  test("leaving Miami for the Gulf, the route goes out to sea and round the Keys, as ships do", async () => {
    const r = await seaPath([MIAMI, COZUMEL]);
    // Where it crosses 82°W: south of Key West (24.55°N), not through Florida Bay behind the Keys.
    const i = r.path.findIndex((p, j) => j > 0 && (r.path[j - 1][0] - -82) * (p[0] - -82) <= 0);
    const [a, b] = [r.path[i - 1], r.path[i]];
    const lat = a[1] + ((b[1] - a[1]) * (-82 - a[0])) / (b[0] - a[0]);
    expect(lat).toBeLessThan(24.55);
  });

  test("a leg between two nearby ports goes straight there, not off to a shipping lane and back", async () => {
    const r = await seaPath([COZUMEL, ROATAN]);
    expect(Math.max(...r.path.map((p) => p[1]))).toBeLessThan(20.7);
    expect(r.distanceM / 1000).toBeLessThan(km(COZUMEL, ROATAN) * 1.25);
  });

  test("Alaska: Seattle to Juneau", async () => {
    const r = await seaPath([SEATTLE, JUNEAU]);
    expect(landCrossings(r.path, [SEATTLE, JUNEAU])).toEqual([]);
    expect(r.distanceM / 1000).toBeLessThan(km(SEATTLE, JUNEAU) * 1.6);
  });

  test("through the Bosporus into the Black Sea", async () => {
    const r = await seaPath([ISTANBUL, ODESSA]);
    expect(landCrossings(r.path, [ISTANBUL, ODESSA])).toEqual([]);
    expect(r.distanceM / 1000).toBeLessThan(km(ISTANBUL, ODESSA) * 1.5);
  });

  test("across the Pacific the line is continuous over the antimeridian", async () => {
    const r = await seaPath([HONOLULU, TOKYO]);
    for (let i = 1; i < r.path.length; i++) expect(Math.abs(r.path[i][0] - r.path[i - 1][0])).toBeLessThan(180);
    // Tokyo, one world to the west.
    expect(r.path[r.path.length - 1][0]).toBeCloseTo(TOKYO[0] - 360, 5);
    expect(r.distanceM / 1000).toBeLessThan(km(HONOLULU, TOKYO) * 1.3);
  });

  test("fast enough to run while someone edits", async () => {
    await seaPath([MIAMI, COZUMEL]);
    const t = performance.now();
    await seaPath([MIAMI, COZUMEL, ROATAN, COSTA_MAYA, MIAMI]);
    expect(performance.now() - t).toBeLessThan(1500);
  });
});
