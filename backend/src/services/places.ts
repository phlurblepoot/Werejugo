import { config } from "../config.js";
import { query } from "../db/pool.js";
import { fold } from "../db/referenceMerge.js";

export interface Place {
  label: string;
  lat: number;
  lng: number;
  source: "airport" | "port" | "geocoder";
  meta?: Record<string, unknown>;
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
/** "US" → "United States" (a code Intl doesn't know is shown as is). */
export const countryName = (code: string | null): string | null => {
  if (!code) return null;
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
};

/** Text for LIKE, with its wildcards as plain characters. */
const likeText = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

interface AirportRow { name: string; city: string | null; lat: number; lng: number; iata: string | null; icao: string | null }

const airportPlace = (a: AirportRow): Place => ({
  label: `${a.iata ?? a.icao ?? ""} — ${a.city ?? a.name}`.trim(),
  lat: a.lat,
  lng: a.lng,
  source: "airport",
  meta: { name: a.name, iata: a.iata, icao: a.icao },
});

/** Resolve an airport by IATA (3-letter) or ICAO (4-letter) code. */
export async function findAirport(code: string): Promise<Place | null> {
  const c = code.trim().toUpperCase();
  const { rows } = await query<AirportRow>(
    `SELECT name, city, lat, lng, iata, icao FROM airports WHERE iata = $1 OR icao = $1
     ORDER BY iata = $1 DESC, array_position(ARRAY['large','medium','small','seaplane'], type) LIMIT 1`,
    [c],
  );
  if (!rows[0]) return null;
  const a = rows[0];
  return { ...airportPlace(a), label: a.city ? `${a.city} (${a.iata ?? a.icao})` : a.name };
}

/** As-you-type airport search: a code first, then names and cities (big airports first). */
export async function searchAirports(q: string, limit = 8): Promise<Place[]> {
  const text = fold(q);
  if (!text) return [];
  const code = q.trim().toUpperCase();
  const { rows } = await query<AirportRow>(
    `SELECT name, city, lat, lng, iata, icao FROM airports
     WHERE iata = $1 OR icao = $1 OR (' ' || search) LIKE $2 OR search % $3
     ORDER BY iata = $1 OR icao = $1 DESC,
              (' ' || search) LIKE $2 DESC,
              array_position(ARRAY['large','medium','small','seaplane'], type),
              similarity(search, $3) DESC
     LIMIT $4`,
    [code, `% ${likeText(text)}%`, text, limit],
  );
  return rows.map(airportPlace);
}

interface PortRow { name: string; country: string | null; lat: number; lng: number }

// Cruise ports (ours and those learned from CruiseMapper) before the rest.
const PORT_ORDER = `array_position(ARRAY['curated','cruisemapper','wpi','unlocode','searoute'], source)`;

/** A port named somewhere else (a CruiseMapper page), from the bundled list only: the best match, or null. */
export async function findPortDb(name: string): Promise<Place | null> {
  // "Skagway (Alaska)" → "Skagway"
  const text = fold(name.split(/[(,]/)[0]);
  if (!text) return null;
  const { rows } = await query<PortRow>(
    `SELECT name, country, lat, lng FROM ports
     WHERE search = $1 OR (' ' || search || ' ') LIKE $2 OR similarity(search, $1) > 0.5
     ORDER BY search = $1 DESC, (' ' || search || ' ') LIKE $2 DESC, ${PORT_ORDER}, similarity(search, $1) DESC
     LIMIT 1`,
    [text, `% ${likeText(text)} %`],
  );
  const p = rows[0];
  return p ? { label: p.name, lat: p.lat, lng: p.lng, source: "port", meta: { country: p.country } } : null;
}

/** Resolve a port by name from the bundled list, then the geocoder. */
export async function findPort(name: string): Promise<Place | null> {
  return (await findPortDb(name)) ?? geocode(name);
}

/** As-you-type port search over names and aliases, ignoring accents and case. */
export async function searchPorts(q: string, limit = 8): Promise<Place[]> {
  const text = fold(q);
  if (!text) return [];
  const { rows } = await query<PortRow>(
    `SELECT name, country, lat, lng FROM ports
     WHERE (' ' || search) LIKE $1 OR search % $2
     ORDER BY (' ' || search) LIKE $1 DESC, ${PORT_ORDER}, similarity(search, $2) DESC, length(name)
     LIMIT $3`,
    [`% ${likeText(text)}%`, text, limit],
  );
  return rows.map((p) => ({
    label: p.country ? `${p.name}, ${countryName(p.country)}` : p.name,
    lat: p.lat,
    lng: p.lng,
    source: "port" as const,
  }));
}

/** Free-form geocoding search via Nominatim — returns multiple matches. */
export async function searchPlaces(q: string, limit = 6): Promise<Place[]> {
  try {
    const url = `${config.nominatimUrl}/search?format=jsonv2&limit=${limit}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "User-Agent": config.nominatimUserAgent } });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
    return data.map((d) => ({
      label: d.display_name,
      lat: Number(d.lat),
      lng: Number(d.lon),
      source: "geocoder" as const,
    }));
  } catch {
    return [];
  }
}

/** Free-form geocoding via OpenStreetMap Nominatim. Best-effort; returns null on failure. */
export async function geocode(q: string): Promise<Place | null> {
  try {
    const url = `${config.nominatimUrl}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "User-Agent": config.nominatimUserAgent } });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
    if (!data[0]) return null;
    return {
      label: data[0].display_name,
      lat: Number(data[0].lat),
      lng: Number(data[0].lon),
      source: "geocoder",
    };
  } catch {
    return null;
  }
}
