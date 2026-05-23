import type { ItemKind } from "../api/client";

export type LngLat = [number, number];

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Points along the great-circle path between two coordinates (inclusive of both ends). */
export function greatCircle(a: LngLat, b: LngLat, segments = 48): LngLat[] {
  const [lng1, lat1] = [toRad(a[0]), toRad(a[1])];
  const [lng2, lat2] = [toRad(b[0]), toRad(b[1])];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
      ),
    );
  if (d === 0) return [a, b];
  const points: LngLat[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lng = Math.atan2(y, x);
    points.push([toDeg(lng), toDeg(lat)]);
  }
  return points;
}

export function greatCirclePath(points: LngLat[], segmentsPerLeg = 48): LngLat[] {
  if (points.length < 2) return points;
  const out: LngLat[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const leg = greatCircle(points[i], points[i + 1], segmentsPerLeg);
    out.push(...(i === 0 ? leg : leg.slice(1)));
  }
  return out;
}

/**
 * Recompute a route's line geometry from its (possibly just-dragged) waypoints.
 * Flights and cruises curve along great-circle arcs; drives connect stops directly.
 */
export function buildRoutePath(kind: ItemKind, coords: LngLat[]): LngLat[] {
  if (coords.length < 2) return coords;
  if (kind === "flight" || kind === "cruise") return greatCirclePath(coords);
  return coords;
}
