export type LngLat = [number, number];

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/**
 * Interpolate points along the great-circle path between two coordinates.
 * Returns `segments + 1` points (inclusive of both endpoints), suitable for a
 * smooth curved LineString on a web map.
 */
export function greatCircle(a: LngLat, b: LngLat, segments = 64): LngLat[] {
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

  // Coincident points: just return the single coordinate.
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

/** Chain great-circle arcs through an ordered list of waypoints. */
export function greatCirclePath(points: LngLat[], segmentsPerLeg = 48): LngLat[] {
  if (points.length < 2) return points;
  const out: LngLat[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const leg = greatCircle(points[i], points[i + 1], segmentsPerLeg);
    // Avoid duplicating the shared vertex between consecutive legs.
    out.push(...(i === 0 ? leg : leg.slice(1)));
  }
  return out;
}

export function lineStringGeoJSON(coords: LngLat[]) {
  return { type: "LineString" as const, coordinates: coords };
}

export function pointGeoJSON(coord: LngLat) {
  return { type: "Point" as const, coordinates: coord };
}
