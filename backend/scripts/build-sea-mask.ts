/**
 * Builds src/data/sea-mask.bin.gz: which parts of the world are water, for sea routes.
 *
 *   npx tsx scripts/build-sea-mask.ts
 *
 * A grid of RES° cells (0.05°, about 5.5 km at the equator) covering the world,
 * one bit per cell: 1 = water. Each cell is sampled at 3×3 points against Natural
 * Earth's land and minor islands (1:10m, public domain); it's water when at least
 * WATER_MIN of the 9 are, so channels down to about a quarter of a cell wide stay
 * open (the entrance to Puget Sound, the Inside Passage's narrows). The lines of
 * Eurostat's shipping-lane network (from searoute-ts, 20 km) are then drawn in as
 * water, so canals and the narrowest straits (Panama, Suez, Kiel, the Bosporus)
 * are open too.
 *
 * File: "SEAMASK2", then width and height (uint32 LE), resolution (float64 LE),
 * then the water bits, then the same again for the lanes (1 = a shipping lane
 * passes through: routes lean towards them), row by row from the north (lat 90)
 * and west (lng -180), gzipped.
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { DEFAULT_MARNET } from "searoute-ts/marnet-20km";

const RES = 0.05;
const W = Math.round(360 / RES);
const H = Math.round(180 / RES);
const SUB = 3; // samples per cell side
const WATER_MIN = 2; // of SUB × SUB
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "sea-mask.bin.gz");

type Ring = number[][];
interface Geo { features: Array<{ geometry: { type: string; coordinates: unknown } }> }

async function rings(file: string): Promise<Ring[]> {
  const r = await fetch(`${NE}/${file}`);
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  const g = (await r.json()) as Geo;
  const all: Ring[] = [];
  for (const f of g.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates as Ring[]] : (f.geometry.coordinates as Ring[][]);
    for (const p of polys) all.push(...p);
  }
  return all;
}

// Land, by scanlines on the sample grid: every ring's edges crossing each sample row,
// filled even-odd (land polygons don't overlap, so holes such as lakes come out as water).
const FW = W * SUB;
const FH = H * SUB;
const FRES = RES / SUB;
const allRings = [...(await rings("ne_10m_land.geojson")), ...(await rings("ne_10m_minor_islands.geojson"))];
const crossings: number[][] = Array.from({ length: FH }, () => []);
for (const ring of allRings) {
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    if (y1 === y2) continue;
    const top = Math.max(y1, y2);
    const bottom = Math.min(y1, y2);
    const rFirst = Math.max(0, Math.ceil((90 - top) / FRES - 0.5));
    const rLast = Math.min(FH - 1, Math.floor((90 - bottom) / FRES - 0.5));
    for (let row = rFirst; row <= rLast; row++) {
      const lat = 90 - (row + 0.5) * FRES;
      if (lat < bottom || lat >= top) continue;
      crossings[row].push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
    }
  }
}
// Land samples per cell, then land = fewer than WATER_MIN water samples.
const land = new Uint8Array(W * H);
const landSamples = new Uint8Array(W);
for (let row = 0; row < H; row++) {
  landSamples.fill(0);
  for (let f = 0; f < SUB; f++) {
    const xs = crossings[row * SUB + f].sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c1 = Math.max(0, Math.ceil((xs[i] + 180) / FRES - 0.5));
      const c2 = Math.min(FW - 1, Math.floor((xs[i + 1] + 180) / FRES - 0.5));
      for (let c = c1; c <= c2; c++) landSamples[Math.floor(c / SUB)]++;
    }
    crossings[row * SUB + f] = [];
  }
  for (let c = 0; c < W; c++) land[row * W + c] = SUB * SUB - landSamples[c] < WATER_MIN ? 1 : 0;
}

// Shipping lanes as water: every network line, cell by cell.
const cellOf = (lng: number, lat: number) => [
  Math.min(W - 1, Math.max(0, Math.floor((lng + 180) / RES))),
  Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / RES))),
];
const lane = new Uint8Array(W * H);
let opened = 0;
for (const f of (DEFAULT_MARNET as { features: Array<{ geometry: { coordinates: number[][] } }> }).features) {
  const c = f.geometry.coordinates;
  for (let i = 0; i < c.length - 1; i++) {
    if (Math.abs(c[i + 1][0] - c[i][0]) > 180) continue; // across the antimeridian
    const steps = Math.ceil(Math.max(Math.abs(c[i + 1][0] - c[i][0]), Math.abs(c[i + 1][1] - c[i][1])) / (RES / 3)) || 1;
    for (let s = 0; s <= steps; s++) {
      const [x, y] = cellOf(c[i][0] + ((c[i + 1][0] - c[i][0]) * s) / steps, c[i][1] + ((c[i + 1][1] - c[i][1]) * s) / steps);
      lane[y * W + x] = 1;
      if (land[y * W + x]) { land[y * W + x] = 0; opened++; }
    }
  }
}

const bits = new Uint8Array(Math.ceil((W * H) / 8));
const laneBits = new Uint8Array(bits.length);
for (let i = 0; i < W * H; i++) {
  if (!land[i]) bits[i >> 3] |= 1 << (i & 7);
  if (lane[i]) laneBits[i >> 3] |= 1 << (i & 7);
}
const head = Buffer.alloc(24);
head.write("SEAMASK2", 0, "ascii");
head.writeUInt32LE(W, 8);
head.writeUInt32LE(H, 12);
head.writeDoubleLE(RES, 16);
const gz = gzipSync(Buffer.concat([head, Buffer.from(bits), Buffer.from(laneBits)]), { level: 9 });
await writeFile(out, gz);
let water = 0;
for (let i = 0; i < W * H; i++) if (!land[i]) water++;
console.log(`wrote ${W}×${H} cells, ${(water / (W * H) * 100).toFixed(1)}% water, ${opened} lane cells opened, ${Math.round(gz.length / 1024)} KB`);
