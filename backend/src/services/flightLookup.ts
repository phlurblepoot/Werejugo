import { config } from "../config.js";
import { greatCirclePath, type LngLat } from "../lib/geo.js";
import { findAirport, type Place } from "./places.js";

export interface LookupWaypoint {
  label: string;
  lng: number;
  lat: number;
  kind: "origin" | "stop" | "destination";
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

/**
 * Resolve a flight *number* to its route via AeroDataBox (RapidAPI), if a key is
 * configured. Falls back to an error result otherwise.
 */
export async function lookupFlightByNumber(flightNumber: string, dateISO: string): Promise<LookupResult> {
  if (!config.aerodataboxKey) {
    return {
      title: "",
      waypoints: [],
      path: [],
      warnings: ["Flight-number lookup is not configured. Set AERODATABOX_RAPIDAPI_KEY, or enter origin/destination airport codes instead."],
    };
  }
  try {
    const fn = encodeURIComponent(flightNumber.trim().toUpperCase());
    const url = `https://aerodatabox.p.rapidapi.com/flights/number/${fn}/${dateISO}`;
    const res = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": config.aerodataboxKey,
        "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com",
      },
    });
    if (!res.ok) {
      return { title: "", waypoints: [], path: [], warnings: [`Flight lookup failed (HTTP ${res.status}).`] };
    }
    const data = (await res.json()) as Array<{
      departure?: { airport?: { iata?: string; icao?: string } };
      arrival?: { airport?: { iata?: string; icao?: string } };
    }>;
    const leg = Array.isArray(data) ? data[0] : undefined;
    const dep = leg?.departure?.airport?.iata ?? leg?.departure?.airport?.icao;
    const arr = leg?.arrival?.airport?.iata ?? leg?.arrival?.airport?.icao;
    if (!dep || !arr) {
      return { title: "", waypoints: [], path: [], warnings: ["Could not determine route for that flight number/date."] };
    }
    const result = await lookupFlightByCodes([dep, arr]);
    result.title = `Flight ${flightNumber.toUpperCase()} (${dep} → ${arr})`;
    return result;
  } catch {
    return { title: "", waypoints: [], path: [], warnings: ["Flight-number lookup errored. Try origin/destination codes."] };
  }
}
