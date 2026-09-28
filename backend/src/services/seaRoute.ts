import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

/**
 * Sea routes: lines between ports that stay on water.
 *
 * The world is a grid of 0.05° cells, water or land (src/data/sea-mask.bin.gz,
 * built by scripts/build-sea-mask.ts from Natural Earth, with the shipping lanes
 * drawn in so canals and narrow straits are open). A leg is the shortest water
 * path on that grid between the two ports (A*, in a box around them that grows
 * when there's no way through), then straightened: each point is joined to the
 * furthest later point it can "see" across water. A leg too long for the grid
 * falls back to searoute-ts's shipping-lane network.
 *
 * Longitudes stay continuous: a line across the antimeridian goes on past ±180
 * (MapLibre draws that as one line).
 */

type Pt = [number, number];

const MASK_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "sea-mask.bin.gz");
const MARGINS = [60, 200, 600]; // cells around the two ports: 3°, 10°, 30°
const MAX_BOX = 6_000_000; // cells; beyond this, the shipping-lane network
const SNAP = 25; // how far (in cells, ~140 km) a port on land looks for water
const LAND_COST = 30; // the last resort: crossing land costs 30 times the distance
const LANE_COST = 0.9; // shipping lanes are a little cheaper, so routes follow them when they're near

interface Mask { w: number; h: number; res: number; bits: Uint8Array; lanes: Uint8Array }
let mask: Mask | null = null;

function grid(): Mask {
  if (!mask) {
    const buf = gunzipSync(readFileSync(MASK_FILE));
    if (buf.toString("ascii", 0, 8) !== "SEAMASK2") throw new Error("sea-mask.bin.gz: not a sea mask");
    const w = buf.readUInt32LE(8);
    const h = buf.readUInt32LE(12);
    const bytes = Math.ceil((w * h) / 8);
    mask = {
      w, h, res: buf.readDoubleLE(16),
      bits: new Uint8Array(buf.buffer, buf.byteOffset + 24, bytes),
      lanes: new Uint8Array(buf.buffer, buf.byteOffset + 24 + bytes, bytes),
    };
  }
  return mask;
}

function water(col: number, row: number): boolean {
  const m = grid();
  if (row < 0 || row >= m.h) return false;
  const c = ((col % m.w) + m.w) % m.w;
  const i = row * m.w + c;
  return ((m.bits[i >> 3] >> (i & 7)) & 1) === 1;
}

function onLane(col: number, row: number): boolean {
  const m = grid();
  const i = row * m.w + (((col % m.w) + m.w) % m.w);
  return ((m.lanes[i >> 3] >> (i & 7)) & 1) === 1;
}

const colOf = (lng: number) => Math.floor((lng + 180) / grid().res);
const rowOf = (lat: number) => Math.floor((90 - lat) / grid().res);
const centre = (col: number, row: number): Pt => [(col + 0.5) * grid().res - 180, 90 - (row + 0.5) * grid().res];

/** Whether a spot is water on the grid. */
export const isWaterAt = (lng: number, lat: number) => water(colOf(lng), rowOf(lat));

/** The nearest water cell to a cell (itself when it's water), or null within SNAP cells. */
function nearestWater(col: number, row: number): Pt | null {
  if (water(col, row)) return [col, row];
  const k = Math.cos((centre(col, row)[1] * Math.PI) / 180);
  for (let r = 1; r <= SNAP; r++) {
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let dc = -r; dc <= r; dc++) {
      for (let dr = -r; dr <= r; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== r || !water(col + dc, row + dr)) continue;
        const d = (dc * k) ** 2 + dr ** 2;
        if (d < bestD) { bestD = d; best = [col + dc, row + dr]; }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Water all the way between two cells' centres: every cell the straight line touches. */
function sees(a: Pt, b: Pt): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const tdx = dx ? Math.abs(1 / dx) : Infinity;
  const tdy = dy ? Math.abs(1 / dy) : Infinity;
  let tx = tdx / 2; // from a cell's centre, half a cell to its edge
  let ty = tdy / 2;
  let x = a[0];
  let y = a[1];
  while (x !== b[0] || y !== b[1]) {
    if (Math.abs(tx - ty) < 1e-9) {
      // Exactly through a corner: both cells beside it count.
      if (!water(x + sx, y) || !water(x, y + sy)) return false;
      x += sx; y += sy; tx += tdx; ty += tdy;
    } else if (tx < ty) {
      x += sx; tx += tdx;
    } else {
      y += sy; ty += tdy;
    }
    if (!water(x, y)) return false;
  }
  return true;
}

/**
 * Shortest water path between two water cells (columns may run past the grid's
 * edge), or null. With `landCost`, land can be crossed at that many times the
 * distance: the last resort for a port in an inlet too narrow for the grid.
 */
function astar(s: Pt, t: Pt, margin: number, landCost = 0): Pt[] | null {
  const m = grid();
  const c0 = Math.min(s[0], t[0]) - margin;
  const bw = Math.min(m.w, Math.max(s[0], t[0]) + margin - c0 + 1);
  const r0 = Math.max(0, Math.min(s[1], t[1]) - margin);
  const bh = Math.min(m.h - 1, Math.max(s[1], t[1]) + margin) - r0 + 1;
  const n = bw * bh;
  if (n > MAX_BOX) return null;

  const kmX = new Float32Array(bh); // km per column step, by row
  for (let r = 0; r < bh; r++) kmX[r] = m.res * 111.32 * Math.cos((centre(0, r0 + r)[1] * Math.PI) / 180);
  const kmY = m.res * 110.57;
  const g = new Float32Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const idx = (c: number, r: number) => (r - r0) * bw + (c - c0);
  const hEst = (c: number, r: number) => LANE_COST * Math.hypot((t[0] - c) * kmX[r - r0], (t[1] - r) * kmY);

  // A binary heap of cell indexes by f = g + h.
  let heapF = new Float64Array(1024);
  let heapI = new Int32Array(1024);
  let size = 0;
  const push = (f: number, i: number) => {
    if (size === heapF.length) {
      const nf = new Float64Array(size * 2); nf.set(heapF); heapF = nf;
      const ni = new Int32Array(size * 2); ni.set(heapI); heapI = ni;
    }
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= f) break;
      heapF[k] = heapF[p]; heapI[k] = heapI[p]; k = p;
    }
    heapF[k] = f; heapI[k] = i;
  };
  const pop = (): number => {
    const top = heapI[0];
    const lf = heapF[--size];
    const li = heapI[size];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= lf) break;
      heapF[k] = heapF[c]; heapI[k] = heapI[c]; k = c;
    }
    heapF[k] = lf; heapI[k] = li;
    return top;
  };

  const start = idx(s[0], s[1]);
  const goal = idx(t[0], t[1]);
  g[start] = 0;
  push(hEst(s[0], s[1]), start);
  while (size) {
    const cur = pop();
    if (done[cur]) continue;
    if (cur === goal) break;
    done[cur] = 1;
    const cc = (cur % bw) + c0;
    const cr = Math.floor(cur / bw) + r0;
    for (let dr = -1; dr <= 1; dr++) {
      const nr = cr + dr;
      if (nr < r0 || nr >= r0 + bh) continue;
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const nc = cc + dc;
        if (nc < c0 || nc >= c0 + bw) continue;
        const wet = water(nc, nr);
        if (!wet && !landCost) continue;
        // Diagonally only past water on both sides (a line through a corner touches both cells).
        if (dc && dr && !landCost && (!water(cc + dc, cr) || !water(cc, cr + dr))) continue;
        const ni = idx(nc, nr);
        if (done[ni]) continue;
        const step = Math.hypot(dc * kmX[cr - r0], dr * kmY) * (!wet ? landCost : onLane(nc, nr) ? LANE_COST : 1);
        const ng = g[cur] + step;
        if (ng < g[ni]) {
          g[ni] = ng;
          from[ni] = cur;
          push(ng + hEst(nc, nr), ni);
        }
      }
    }
  }
  if (from[goal] === -1 && goal !== start) return null;

  const cells: Pt[] = [];
  for (let i = goal; i !== -1; i = from[i]) cells.push([(i % bw) + c0, Math.floor(i / bw) + r0]);
  cells.reverse();

  // Straighten: from each point, on to the furthest point it can see.
  const out: Pt[] = [cells[0]];
  for (let i = 0; i < cells.length - 1;) {
    let j = i + 1;
    while (j + 1 < cells.length && sees(cells[i], cells[j + 1])) j++;
    out.push(cells[j]);
    i = j;
  }
  return out;
}

/** Longitudes made continuous: each point within 180° of the one before. */
function unwrap(path: Pt[], from?: number): Pt[] {
  let prev = from ?? path[0]?.[0];
  return path.map(([lng, lat]) => {
    const x = lng + Math.round((prev - lng) / 360) * 360;
    prev = x;
    return [x, lat];
  });
}

let lanes: ((a: Pt, b: Pt) => Pt[]) | null = null;
async function laneLeg(a: Pt, b: Pt): Promise<Pt[]> {
  if (!lanes) {
    const { seaRoute } = await import("searoute-ts");
    lanes = (x, y) => seaRoute(x, y).geometry.coordinates as Pt[];
  }
  return unwrap([a, ...lanes(a, b), b]);
}

async function leg(a: Pt, b: Pt): Promise<Pt[]> {
  const m = grid();
  // Go the short way round: the far port's column is moved within half a world.
  const bLng = b[0] + Math.round((a[0] - b[0]) / 360) * 360;
  const s = nearestWater(colOf(a[0]), rowOf(a[1]));
  const tRaw = nearestWater(colOf(b[0]), rowOf(b[1]));
  if (s && tRaw) {
    const t: Pt = [tRaw[0] + Math.round((colOf(bLng) - tRaw[0]) / m.w) * m.w, tRaw[1]];
    const tries: Array<[number, number]> = [...MARGINS.map((m): [number, number] => [m, 0]), [MARGINS[1], LAND_COST]];
    for (const [margin, landCost] of tries) {
      const cells = astar(s, t, margin, landCost);
      if (!cells) continue;
      const mid = cells.map(([c, r]) => centre(c, r));
      // The ports themselves at the ends, instead of their cells' centres when those are water.
      if (water(colOf(a[0]), rowOf(a[1]))) mid.shift();
      if (water(colOf(b[0]), rowOf(b[1]))) mid.pop();
      return unwrap([a, ...mid, [bLng, b[1]]]);
    }
  }
  return laneLeg(a, b);
}

const R = 6371008.8;
function metres(path: Pt[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) {
    const [lng1, lat1] = path[i - 1];
    const [lng2, lat2] = path[i];
    const r = Math.PI / 180;
    const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
    d += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return d;
}

/** A line through the ports, in order, that stays on water; with its length in metres. */
export async function seaPath(points: Pt[]): Promise<{ path: number[][]; distanceM: number }> {
  let path: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const l = await leg(a, b);
    const joined = path.length ? unwrap(l, path[path.length - 1][0]) : l;
    path = path.length ? [...path, ...joined.slice(1)] : joined;
  }
  if (!path.length && points.length) path = [points[0]];
  return { path, distanceM: Math.round(metres(path)) };
}
