import { config } from "../config.js";
import { query } from "../db/pool.js";

export interface Place {
  label: string;
  lat: number;
  lng: number;
  source: "airport" | "port" | "geocoder";
  meta?: Record<string, unknown>;
}

/** Resolve an airport by IATA (3-letter) or ICAO (4-letter) code. */
export async function findAirport(code: string): Promise<Place | null> {
  const c = code.trim().toUpperCase();
  const { rows } = await query<{ name: string; city: string | null; lat: number; lng: number; iata: string | null; icao: string | null }>(
    "SELECT name, city, lat, lng, iata, icao FROM airports WHERE iata = $1 OR icao = $1 LIMIT 1",
    [c],
  );
  if (!rows[0]) return null;
  const a = rows[0];
  return {
    label: a.city ? `${a.city} (${a.iata ?? a.icao})` : a.name,
    lat: a.lat,
    lng: a.lng,
    source: "airport",
    meta: { name: a.name, iata: a.iata, icao: a.icao },
  };
}

export async function searchAirports(q: string, limit = 8): Promise<Place[]> {
  const term = `%${q.trim().toLowerCase()}%`;
  const { rows } = await query<{ name: string; city: string | null; lat: number; lng: number; iata: string | null; icao: string | null }>(
    `SELECT name, city, lat, lng, iata, icao FROM airports
     WHERE lower(name) LIKE $1 OR lower(city) LIKE $1 OR lower(iata) LIKE $1 OR lower(icao) LIKE $1
     LIMIT $2`,
    [term, limit],
  );
  return rows.map((a) => ({
    label: `${a.iata ?? a.icao ?? ""} — ${a.city ?? a.name}`.trim(),
    lat: a.lat,
    lng: a.lng,
    source: "airport" as const,
    meta: { name: a.name, iata: a.iata, icao: a.icao },
  }));
}

/** Resolve a port by (fuzzy) name from the bundled dataset only (no geocoding). */
export async function findPortDb(name: string): Promise<Place | null> {
  const term = `%${name.trim().toLowerCase()}%`;
  const { rows } = await query<{ name: string; country: string | null; lat: number; lng: number }>(
    "SELECT name, country, lat, lng FROM ports WHERE lower(name) LIKE $1 ORDER BY length(name) ASC LIMIT 1",
    [term],
  );
  if (rows[0]) {
    const p = rows[0];
    return { label: p.name, lat: p.lat, lng: p.lng, source: "port", meta: { country: p.country } };
  }
  return null;
}

/** Resolve a port by name from the bundled dataset, then geocoder fallback. */
export async function findPort(name: string): Promise<Place | null> {
  return (await findPortDb(name)) ?? geocode(name);
}

export async function searchPorts(q: string, limit = 8): Promise<Place[]> {
  const term = `%${q.trim().toLowerCase()}%`;
  const { rows } = await query<{ name: string; country: string | null; lat: number; lng: number }>(
    "SELECT name, country, lat, lng FROM ports WHERE lower(name) LIKE $1 LIMIT $2",
    [term, limit],
  );
  return rows.map((p) => ({
    label: p.country ? `${p.name}, ${p.country}` : p.name,
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
