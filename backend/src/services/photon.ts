import { config } from "../config.js";
import { fold } from "../db/referenceMerge.js";
import { cached, DAY } from "../lib/lookupCache.js";
import type { Place } from "./places.js";

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string; street?: string; housenumber?: string; city?: string; state?: string; country?: string;
    countrycode?: string; type?: string; osm_value?: string;
  };
}

/** "Colosseum, Rome, Lazio, Italy": the place, then where it is, without repeats. */
function label(p: PhotonFeature["properties"]): string {
  const street = p.street ? [p.housenumber, p.street].filter(Boolean).join(" ") : undefined;
  const parts = [p.name ?? street, p.city, p.state, p.country].filter((x): x is string => !!x);
  return parts.filter((x, i) => parts.indexOf(x) === i).join(", ");
}

/**
 * Place search with Photon (as you type; a week's cache). `near` puts places
 * near the map's centre first. A failure is an empty list, not kept.
 */
export async function photonSearch(q: string, opts: { near?: { lng: number; lat: number }; limit?: number } = {}): Promise<Place[]> {
  const text = q.trim();
  if (!text) return [];
  const limit = opts.limit ?? 6;
  const near = opts.near ? `${opts.near.lng.toFixed(1)},${opts.near.lat.toFixed(1)}` : "";
  try {
    return await cached(`photon:${fold(text)}:${near}:${limit}`, 7 * DAY, async () => {
      const url = new URL(`${config.photonUrl}/api`);
      url.searchParams.set("q", text);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("lang", "en");
      if (opts.near) {
        url.searchParams.set("lat", opts.near.lat.toFixed(3));
        url.searchParams.set("lon", opts.near.lng.toFixed(3));
      }
      const res = await fetch(url, { headers: { "User-Agent": config.userAgent }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Photon: HTTP ${res.status}`);
      const data = (await res.json()) as { features?: PhotonFeature[] };
      return (data.features ?? [])
        .filter((f) => Array.isArray(f.geometry?.coordinates))
        .map((f): Place => ({
          label: label(f.properties),
          lng: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
          source: "geocoder",
          meta: { type: f.properties.type ?? f.properties.osm_value ?? null, country: f.properties.countrycode ?? null },
        }))
        .filter((p) => p.label);
    });
  } catch {
    return [];
  }
}
