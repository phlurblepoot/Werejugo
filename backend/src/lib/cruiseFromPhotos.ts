import { query } from "../db/pool.js";
import { seaPath } from "../services/seaRoute.js";
import type { Scope } from "./access.js";
import { HttpError } from "./errors.js";

/**
 * A cruise from the family's photos: where the ship called, and the trail it
 * took, from where and when the photos were taken.
 *
 * - A photo is **at sea** when it has a location but Immich gave it no country
 *   (Immich names a city only within 25 km of a populated place, and a country
 *   only on land), and it's more than 15 km from any port.
 * - A **port call** is a day with photos ashore: the port nearest to that day's
 *   photo closest to a port (within 40 km). That's the pier photo, not the
 *   excursion inland. The same port on consecutive calls is one call.
 * - The **trail** runs through the port calls and the sea photos in time order
 *   (sea photos thinned to one per 2 hours), along water between them.
 */

export interface PhotoPoint { id: string; t: number; lat: number; lng: number; country: string | null }
export interface PortRef { name: string; lat: number; lng: number }
export interface CruiseCall { label: string; lat: number; lng: number; dateISO: string; kind: "origin" | "port" | "destination" }
export interface CruisePlan {
  calls: CruiseCall[];
  /** Ports and sea photos in time order: the trail goes through these. */
  sequence: Array<[number, number]>;
  seaPhotos: number;
  photoIds: string[];
}

const SEA_PORT_KM = 15;
const CALL_KM = 40;
const SEA_GAP_MS = 2 * 3600_000;

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12_742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function nearest(p: { lat: number; lng: number }, ports: PortRef[]): { port: PortRef; km: number } | null {
  let best: { port: PortRef; km: number } | null = null;
  for (const port of ports) {
    const d = km(p, port);
    if (!best || d < best.km) best = { port, km: d };
  }
  return best;
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The cruise the photos show, or null when they don't show one (two ports, or photos at sea on two days). */
export function planCruise(points: PhotoPoint[], ports: PortRef[]): CruisePlan | null {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const isSea = (p: PhotoPoint) => !p.country && (nearest(p, ports)?.km ?? Infinity) > SEA_PORT_KM;
  const sea = sorted.filter(isSea);
  const ashore = sorted.filter((p) => !isSea(p));

  // One call per day ashore: the port nearest that day's photo closest to a port.
  const byDay = new Map<string, PhotoPoint[]>();
  for (const p of ashore) byDay.set(dayOf(p.t), [...(byDay.get(dayOf(p.t)) ?? []), p]);
  const calls: Array<CruiseCall & { t: number }> = [];
  for (const [day, photos] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
    let best: { port: PortRef; km: number; t: number } | null = null;
    for (const p of photos) {
      const n = nearest(p, ports);
      if (n && n.km <= CALL_KM && (!best || n.km < best.km)) best = { ...n, t: p.t };
    }
    if (!best) continue;
    const last = calls[calls.length - 1];
    if (last && last.label === best.port.name) continue;
    calls.push({ label: best.port.name, lat: best.port.lat, lng: best.port.lng, dateISO: day, kind: "port", t: best.t });
  }
  const seaDays = new Set(sea.map((p) => dayOf(p.t))).size;
  if (calls.length < 2 && !(sea.length >= 3 && seaDays >= 2)) return null;
  calls.forEach((c, i) => { c.kind = i === 0 ? "origin" : i === calls.length - 1 ? "destination" : "port"; });

  // The trail: port calls and sea photos in time order (a burst of sea photos counts once).
  const kept: PhotoPoint[] = [];
  for (const p of sea) if (!kept.length || p.t - kept[kept.length - 1].t >= SEA_GAP_MS) kept.push(p);
  const stops = [
    ...calls.map((c) => ({ t: c.t, at: [c.lng, c.lat] as [number, number] })),
    ...kept.map((p) => ({ t: p.t, at: [p.lng, p.lat] as [number, number] })),
  ].sort((a, b) => a.t - b.t);

  return {
    calls: calls.map(({ t: _t, ...c }) => c),
    sequence: stops.map((s) => s.at),
    seaPhotos: sea.length,
    photoIds: sorted.map((p) => p.id),
  };
}

/** The ports near some photos (their area, and half a degree around it). */
export async function portsNear(points: Array<{ lat: number; lng: number }>): Promise<PortRef[]> {
  if (!points.length) return [];
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return (await query<PortRef>(
    `SELECT name, lat, lng FROM ports WHERE lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4`,
    [Math.min(...lats) - 0.5, Math.max(...lats) + 0.5, Math.min(...lngs) - 0.5, Math.max(...lngs) + 0.5],
  )).rows;
}

export interface CruiseProposal {
  ports: Array<{ label: string; lng: number; lat: number; kind: CruiseCall["kind"]; arriveAt: string | null; departAt: string | null }>;
  path: number[][];
  distanceM: number;
  photoIds: string[];
  seaPhotos: number;
}

/** Waypoints for a plan's calls: the day of each (setting off from the first, arriving at the others). */
export const callWaypoints = (calls: CruiseCall[]): CruiseProposal["ports"] =>
  calls.map((c, i) => ({
    label: c.label, lng: c.lng, lat: c.lat, kind: c.kind,
    arriveAt: i === 0 ? null : `${c.dateISO}T00:00:00.000Z`,
    departAt: i === 0 ? `${c.dateISO}T00:00:00.000Z` : null,
  }));

/** The cruise my family's photos from these days show (a 422 saying why when they don't). */
export async function proposeCruise(scope: Scope, opts: { from: string; to: string }): Promise<CruiseProposal> {
  const points = (await query<{ id: string; t: Date; lat: number; lng: number; country: string | null }>(
    `SELECT id, taken_at AS t, ST_Y(geom) AS lat, ST_X(geom) AS lng, country FROM media
      WHERE family_id = $1 AND hidden_at IS NULL AND geom IS NOT NULL
        AND taken_at >= $2::date AND taken_at < $3::date + 1
      ORDER BY taken_at, id`,
    [scope.familyId, opts.from, opts.to],
  )).rows.map((r) => ({ id: r.id, t: new Date(r.t).getTime(), lat: r.lat, lng: r.lng, country: r.country }));
  const plan = planCruise(points, await portsNear(points));
  if (!plan) {
    throw new HttpError(422, "Not enough photos with a location from those days to build the cruise (it needs two ports, or photos at sea on two days).");
  }
  const route = await seaPath(plan.sequence);
  return { ports: callWaypoints(plan.calls), path: route.path, distanceM: route.distanceM, photoIds: plan.photoIds, seaPhotos: plan.seaPhotos };
}
