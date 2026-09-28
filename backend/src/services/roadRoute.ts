import { config } from "../config.js";
import { cached, DAY } from "../lib/lookupCache.js";

/** Why a road route couldn't be had, in words for the person editing. */
export class RoadRouteError extends Error {}

const MAX_POINTS = 5000; // a whole cross-country drive fits; beyond, the line is thinned

/**
 * A drive along roads through the stops, in order, from the OSRM server at
 * ROUTING_URL (kept 30 days: roads rarely move). Throws RoadRouteError.
 */
export async function roadPath(points: [number, number][]): Promise<{ path: number[][]; distanceM: number }> {
  const coords = points.map(([lng, lat]) => `${+lng.toFixed(5)},${+lat.toFixed(5)}`).join(";");
  return cached(`osrm:${coords}`, 30 * DAY, async () => {
    let res: Response;
    try {
      res = await fetch(`${config.routingUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`, {
        headers: { "User-Agent": config.userAgent },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new RoadRouteError("The road routing server isn't answering right now.");
    }
    const body = (await res.json().catch(() => null)) as
      | { code?: string; routes?: Array<{ geometry: { coordinates: number[][] }; distance: number }> }
      | null;
    if (body?.code === "NoRoute" || body?.code === "NoSegment") throw new RoadRouteError("No road route between these stops.");
    if (!res.ok || body?.code !== "Ok" || !body.routes?.[0]) throw new RoadRouteError("The road routing server isn't answering right now.");
    const route = body.routes[0];
    let path = route.geometry.coordinates;
    // Start and end exactly at the stops, not where the road nearest them is.
    path = [points[0], ...path.slice(1, -1), points[points.length - 1]];
    return { path: thin(path, MAX_POINTS), distanceM: Math.round(route.distance) };
  });
}

/** At most `max` points, keeping the ends (every nth point: road geometry is dense and even). */
function thin(path: number[][], max: number): number[][] {
  if (path.length <= max) return path;
  const step = (path.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => path[Math.round(i * step)]);
}
