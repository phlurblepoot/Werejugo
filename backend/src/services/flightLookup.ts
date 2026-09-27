import { config } from "../config.js";
import { greatCirclePath, type LngLat } from "../lib/geo.js";
import { cached, DAY, HOUR } from "../lib/lookupCache.js";
import { findAirport, type Place } from "./places.js";

export interface LookupWaypoint {
  label: string;
  lng: number;
  lat: number;
  kind: "origin" | "stop" | "destination";
  /** Local wall-clock times at the airport, written as UTC. */
  arriveAt?: string;
  departAt?: string;
}

export interface LookupResult {
  title: string;
  waypoints: LookupWaypoint[];
  path: LngLat[];
  warnings: string[];
  image?: string | null;
}

/**
 * Build a flight route. Provide an ordered list of airport codes (IATA/ICAO);
 * the first is the origin, the last the destination, any middle ones are stops.
 */
export async function lookupFlightByCodes(codes: string[]): Promise<LookupResult> {
  const warnings: string[] = [];
  const resolved: Array<{ code: string; place: Place }> = [];

  for (const code of codes) {
    const place = await findAirport(code);
    if (place) {
      resolved.push({ code: code.toUpperCase(), place });
    } else {
      warnings.push(`Unknown airport code: ${code.toUpperCase()}`);
    }
  }

  if (resolved.length < 2) {
    return { title: "", waypoints: [], path: [], warnings: [...warnings, "Need at least two known airports."] };
  }

  const waypoints: LookupWaypoint[] = resolved.map((r, i) => ({
    label: r.place.label,
    lng: r.place.lng,
    lat: r.place.lat,
    kind: i === 0 ? "origin" : i === resolved.length - 1 ? "destination" : "stop",
  }));

  const path = greatCirclePath(waypoints.map((w) => [w.lng, w.lat] as LngLat));
  const first = resolved[0].code;
  const last = resolved[resolved.length - 1].code;
  return { title: `Flight ${first} → ${last}`, waypoints, path, warnings };
}

interface AdbAirport { iata?: string; icao?: string; municipalityName?: string; name?: string; location?: { lat: number; lon: number } }
interface AdbLeg {
  number?: string;
  airline?: { name?: string };
  departure?: { airport?: AdbAirport; scheduledTime?: { local?: string } };
  arrival?: { airport?: AdbAirport; scheduledTime?: { local?: string } };
}

/** "2025-05-01 21:30-04:00" → its instant (ms), and the wall-clock time there written as UTC. */
function localTime(s?: string): { at: number; wall: string } | null {
  const m = s?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?([-+]\d{2}:\d{2}|Z)?$/);
  if (!m) return null;
  const wall = `${m[1]}T${m[2]}:00.000Z`;
  const at = Date.parse(`${m[1]}T${m[2]}:00${m[3] ?? "Z"}`);
  return Number.isNaN(at) ? null : { at, wall };
}

class DateOutOfRange extends Error {}

const code = (a?: AdbAirport) => a?.iata ?? a?.icao ?? "";

/**
 * A flight *number* on the day it left (local date at its origin) via AeroDataBox
 * (RapidAPI, AERODATABOX_RAPIDAPI_KEY): every leg, chained in order (MDW → DEN →
 * PHX), with each airport's local departure and arrival times (written as UTC:
 * the waypoint convention). Answers are kept 30 days (6 hours for a flight that
 * hasn't flown yet, whose times can change).
 */
export async function lookupFlightByNumber(flightNumber: string, dateISO: string): Promise<LookupResult & { date?: string }> {
  const none = (warning: string) => ({ title: "", waypoints: [], path: [], warnings: [warning] });
  if (!config.aerodataboxKey) {
    return none("Flight-number lookup isn't set up on this server (AERODATABOX_RAPIDAPI_KEY). Pick the airports instead.");
  }
  const fn = flightNumber.replace(/\s+/g, "").toUpperCase();
  const past = dateISO < new Date().toISOString().slice(0, 10);
  let legs: AdbLeg[] | null;
  try {
    legs = await cached(`aerodatabox:${fn}:${dateISO}`, past ? 30 * DAY : 6 * HOUR, async () => {
      const res = await fetch(`${config.aerodataboxUrl}/flights/number/${encodeURIComponent(fn)}/${dateISO}`, {
        headers: { "X-RapidAPI-Key": config.aerodataboxKey, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 204 || res.status === 404) return null;
      if (res.status === 400) throw new DateOutOfRange();
      if (!res.ok) throw new Error(`AeroDataBox: HTTP ${res.status}`);
      const data = (await res.json()) as AdbLeg[];
      return Array.isArray(data) && data.length ? data : null;
    });
  } catch (err) {
    if (err instanceof DateOutOfRange) {
      return none(`AeroDataBox can't look up flights on ${dateISO} (it covers about a year either side of today). Pick the airports instead.`);
    }
    return none("The flight lookup isn't answering right now. Try again, or pick the airports instead.");
  }
  if (!legs) return none(`No flight ${fn} found on ${dateISO}. Check the number and the date (the day it left, where it left from).`);

  // Chain the legs: the earliest, then the one leaving from where it landed, and so on.
  const sorted = legs
    .filter((l) => code(l.departure?.airport) && code(l.arrival?.airport))
    .sort((a, b) => (localTime(a.departure?.scheduledTime?.local)?.at ?? 0) - (localTime(b.departure?.scheduledTime?.local)?.at ?? 0));
  const chain: AdbLeg[] = sorted.length ? [sorted[0]] : [];
  for (const l of sorted.slice(1)) {
    if (code(l.departure?.airport) === code(chain[chain.length - 1].arrival?.airport)) chain.push(l);
  }
  const warnings = sorted
    .filter((l) => !chain.includes(l))
    .map((l) => `${fn} also flies ${code(l.departure?.airport)} → ${code(l.arrival?.airport)} that day; left out.`);
  if (!chain.length) return none(`Couldn't tell the route of ${fn} on ${dateISO}.`);

  const airports = [chain[0].departure!.airport!, ...chain.map((l) => l.arrival!.airport!)];
  const waypoints: LookupWaypoint[] = [];
  for (let i = 0; i < airports.length; i++) {
    const a = airports[i];
    const known = await findAirport(code(a));
    const lat = known?.lat ?? a.location?.lat;
    const lng = known?.lng ?? a.location?.lon;
    if (lat == null || lng == null) return none(`Couldn't place the airport ${code(a)} on the map. Pick the airports instead.`);
    const arrive = i > 0 ? localTime(chain[i - 1].arrival?.scheduledTime?.local)?.wall ?? null : null;
    const depart = i < chain.length ? localTime(chain[i].departure?.scheduledTime?.local)?.wall ?? null : null;
    waypoints.push({
      label: known?.label ?? `${a.municipalityName ?? a.name ?? code(a)} (${code(a)})`,
      lng, lat,
      kind: i === 0 ? "origin" : i === airports.length - 1 ? "destination" : "stop",
      ...(arrive ? { arriveAt: arrive } : {}),
      ...(depart ? { departAt: depart } : {}),
    });
  }
  const airline = chain[0].airline?.name;
  return {
    title: `${airline ? `${airline} ` : ""}${fn} (${airports.map(code).join(" → ")})`,
    date: localTime(chain[0].departure?.scheduledTime?.local)?.wall.slice(0, 10) ?? dateISO,
    waypoints,
    path: greatCirclePath(waypoints.map((w) => [w.lng, w.lat] as LngLat)),
    warnings,
  };
}
