import type { Item } from "../api/client";
import type { LngLat } from "./geo";

interface CountryFeature {
  type: "Feature";
  id?: string;
  properties: { name: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
}
export interface CountryCollection {
  type: "FeatureCollection";
  features: CountryFeature[];
}

let cache: CountryCollection | null = null;

/** Lazily load the bundled low-resolution world countries GeoJSON. */
export async function loadCountries(): Promise<CountryCollection> {
  if (cache) return cache;
  const mod = await import("../data/countries.geo.json");
  cache = (mod.default ?? mod) as unknown as CountryCollection;
  return cache;
}

function pointInRing(pt: LngLat, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInFeature(pt: LngLat, f: CountryFeature): boolean {
  if (f.geometry.type === "Polygon") {
    return pointInRing(pt, (f.geometry.coordinates as number[][][])[0]);
  }
  for (const poly of f.geometry.coordinates as number[][][][]) {
    if (pointInRing(pt, poly[0])) return true;
  }
  return false;
}

/** Collect representative coordinates from an item (point, waypoints, line endpoints). */
function itemPoints(item: Item): LngLat[] {
  const pts: LngLat[] = [];
  if (item.geometry?.type === "Point") {
    const c = item.geometry.coordinates as number[];
    pts.push([c[0], c[1]]);
  }
  for (const w of item.waypoints) pts.push([w.lng, w.lat]);
  if (item.geometry?.type === "LineString" && item.waypoints.length === 0) {
    const coords = item.geometry.coordinates as number[][];
    if (coords[0]) pts.push([coords[0][0], coords[0][1]]);
    if (coords.at(-1)) pts.push([coords.at(-1)![0], coords.at(-1)![1]]);
  }
  return pts;
}

/** Return the set of country feature ids that contain any item coordinate. */
export function visitedCountryIds(items: Item[], countries: CountryCollection): Set<string> {
  const visited = new Set<string>();
  const pts = items.flatMap(itemPoints);
  for (const f of countries.features) {
    const id = f.id ?? f.properties.name;
    if (visited.has(id)) continue;
    for (const pt of pts) {
      if (pointInFeature(pt, f)) {
        visited.add(id);
        break;
      }
    }
  }
  return visited;
}
