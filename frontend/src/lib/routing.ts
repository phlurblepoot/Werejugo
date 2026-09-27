import { api, type ItemKind, type RouteInfo } from "../api/client";
import { greatCirclePath, type LngLat } from "./geo";

const R = 6371008.8;
/** Length of a line in metres (longitudes may run past ±180). */
export function lineMetres(path: number[][]): number {
  let d = 0;
  const r = Math.PI / 180;
  for (let i = 1; i < path.length; i++) {
    const [lng1, lat1] = path[i - 1];
    const [lng2, lat2] = path[i];
    const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
    d += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return Math.round(d);
}

/** "412 km (256 mi)" */
export const formatDistance = (m: number) =>
  `${Math.round(m / 1000).toLocaleString()} km (${Math.round(m / 1609.344).toLocaleString()} mi)`;

export interface ComputedRoute { path: number[][]; route: RouteInfo; note?: string }

/**
 * The line through a route's stops: along roads for a drive, across water for a
 * cruise, great-circle arcs for a flight. When the routing service can't help,
 * the stops are joined directly (arcs for a cruise), with a note saying why.
 */
export async function computeRoute(kind: ItemKind, coords: LngLat[]): Promise<ComputedRoute> {
  const arcs = (): ComputedRoute => {
    const path = greatCirclePath(coords);
    return { path, route: { source: "great-circle", distanceM: lineMetres(path) } };
  };
  if (kind === "drive") {
    try {
      const r = await api.routeRoad(coords);
      return { path: r.path, route: { source: "road", distanceM: r.distanceM } };
    } catch (e) {
      const why = e instanceof Error && e.message ? e.message : "Couldn't find a road route.";
      return { path: coords, route: { source: "straight", distanceM: lineMetres(coords) }, note: `${why} The stops are joined directly for now.` };
    }
  }
  if (kind === "cruise") {
    try {
      const r = await api.routeSea(coords);
      return { path: r.path, route: { source: "sea", distanceM: r.distanceM } };
    } catch {
      return { ...arcs(), note: "Couldn't work out the route by sea. The ports are joined directly for now." };
    }
  }
  return arcs();
}
