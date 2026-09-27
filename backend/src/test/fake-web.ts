/**
 * Stand-ins for the outside services the map uses, on one local port, each
 * under its own path with the real service's request and response shapes:
 *
 * - `/photon/api` — Photon place search (GeoJSON features).
 *
 * Point `config` at `${url}/<service>` in a test. `calls` records every request
 * ("photon q=rome"); `down` makes a service answer 503.
 */
import Fastify from "fastify";
import { fold } from "../db/referenceMerge.js";

export interface FakePlace {
  name: string;
  lng: number;
  lat: number;
  type: string; // Photon's `type`: house, street, city, country…
  city?: string;
  state?: string;
  country: string;
  countrycode: string;
}

export const PLACES: FakePlace[] = [
  { name: "Colosseum", lng: 12.4924, lat: 41.8902, type: "house", city: "Rome", state: "Lazio", country: "Italy", countrycode: "IT" },
  { name: "Rome", lng: 12.4829, lat: 41.8933, type: "city", state: "Lazio", country: "Italy", countrycode: "IT" },
  { name: "Rome", lng: -85.1647, lat: 34.2570, type: "city", state: "Georgia", country: "United States", countrycode: "US" },
  { name: "Eiffel Tower", lng: 2.2945, lat: 48.8584, type: "house", city: "Paris", state: "Île-de-France", country: "France", countrycode: "FR" },
  { name: "Labadee", lng: -72.2479, lat: 19.7841, type: "locality", state: "Nord", country: "Haiti", countrycode: "HT" },
  { name: "Golden Gate Bridge", lng: -122.4783, lat: 37.8199, type: "street", city: "San Francisco", state: "California", country: "United States", countrycode: "US" },
  { name: "South Lake Tahoe", lng: -119.9772, lat: 38.9399, type: "city", state: "California", country: "United States", countrycode: "US" },
];

export interface FakeWeb {
  url: string;
  calls: string[];
  down: Set<string>;
  places: FakePlace[];
  close(): Promise<void>;
}

export async function startFakeWeb(): Promise<FakeWeb> {
  const app = Fastify({ logger: false });
  const calls: string[] = [];
  const down = new Set<string>();
  const places = [...PLACES];

  app.addHook("onRequest", async (req, reply) => {
    const service = req.url.split("/")[1];
    if (down.has(service)) return reply.code(503).send({ message: "down" });
  });

  // Photon: https://photon.komoot.io/api?q=…&limit=…&lat=…&lon=…&lang=en
  app.get("/photon/api", async (req) => {
    const q = req.query as { q?: string; limit?: string; lat?: string; lon?: string };
    calls.push(`photon q=${q.q ?? ""}${q.lat ? ` near=${q.lon},${q.lat}` : ""}`);
    const words = fold(q.q ?? "").split(" ").filter(Boolean);
    let hits = places.filter((p) => {
      const text = fold(`${p.name} ${p.city ?? ""} ${p.state ?? ""} ${p.country}`);
      return words.every((w) => text.split(" ").some((t) => t.startsWith(w)));
    });
    // Like Photon: places named what was typed first, then (with a location) the nearest.
    const named = (p: FakePlace) => (words.every((w) => fold(p.name).split(" ").some((t) => t.startsWith(w))) ? 0 : 1);
    const lat = Number(q.lat);
    const lon = Number(q.lon);
    const dist = (p: FakePlace) => (q.lat && q.lon ? Math.hypot(p.lat - lat, p.lng - lon) : 0);
    hits = [...hits].sort((a, b) => named(a) - named(b) || dist(a) - dist(b));
    return {
      type: "FeatureCollection",
      features: hits.slice(0, Number(q.limit ?? 15)).map((p, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: {
          osm_type: "N", osm_id: 1000 + i, osm_key: "place", osm_value: p.type, type: p.type,
          name: p.name, city: p.city, state: p.state, country: p.country, countrycode: p.countrycode,
        },
      })),
    };
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, calls, down, places, close: () => app.close() };
}
