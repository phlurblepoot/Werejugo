/**
 * Stand-ins for the outside services the map uses, on one local port, each
 * under its own path with the real service's request and response shapes:
 *
 * - `/photon/api` — Photon place search (GeoJSON features).
 * - `/osrm/route/v1/driving/{lng,lat;…}` — an OSRM server's road route: each leg
 *   bends through a point beside the straight line, as roads do.
 * - `/cruisemapper/…` — CruiseMapper's pages as Werejugo reads them: the cruise
 *   lines, a line's ships, a ship's page (its upcoming sailings and ports), and
 *   a sailing's two JSON files (`/map/cruise.json`, the track and port
 *   coordinates; `/ships/cruise.json`, the day-by-day ports). The JSON answers
 *   only requests that look like a browser's XHR; others are redirected to the
 *   ship's page, as the real site does.
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

/** A port call on a fake sailing: "9 Nov" with "08:00 - 17:00", "Departing 16:30"… */
export interface FakeCall { name: string; poi: string; lat: number; lng: number; day: string; time: string; how?: "Departing" | "Arriving" }
export interface FakeSailing { id: string; ship: string; date: string; title: string; departure: string; calls: FakeCall[]; atSea?: string[] }
export interface FakeShip { slug: string; name: string; line: string; sailings: string[] }

const MIAMI = { name: "Miami (Florida)", poi: "1", lat: 25.7743, lng: -80.1799 };
const LABADEE = { name: "Labadee", poi: "47", lat: 19.7841, lng: -72.2479 };
const COCOCAY = { name: "CocoCay (Little Stirrup Cay)", poi: "88", lat: 25.8176, lng: -77.9391 };
const COZUMEL = { name: "Cozumel", poi: "12", lat: 20.5079, lng: -86.9476 };
const ROATAN = { name: "Roatan", poi: "31", lat: 16.3160, lng: -86.5360 };
const COSTA_MAYA = { name: "Costa Maya", poi: "44", lat: 18.7290, lng: -87.6900 };

export const CRUISE_LINES = [
  { name: "Royal Caribbean", slug: "Royal-Caribbean-1" },
  { name: "Carnival Cruise Line", slug: "Carnival-Cruise-Line-2" },
];
export const SHIPS: FakeShip[] = [
  { slug: "Symphony-of-the-Seas-1185", name: "Symphony of the Seas", line: "Royal-Caribbean-1", sailings: ["9001", "9002"] },
  { slug: "Wonder-of-the-Seas-2071", name: "Wonder of the Seas", line: "Royal-Caribbean-1", sailings: ["9101", "9102"] },
  { slug: "Carnival-Breeze-770", name: "Carnival Breeze", line: "Carnival-Cruise-Line-2", sailings: [] },
];
export const SAILINGS: FakeSailing[] = [
  {
    id: "9001", ship: "Symphony-of-the-Seas-1185", date: "2026-11-07", title: "7 Night Eastern Caribbean", departure: "Miami",
    calls: [
      { ...MIAMI, day: "7 Nov", time: "16:30", how: "Departing" },
      { ...LABADEE, day: "9 Nov", time: "08:00 - 17:00" },
      { ...COCOCAY, day: "12 Nov", time: "07:00 - 17:00" },
      { ...MIAMI, day: "14 Nov", time: "06:00", how: "Arriving" },
    ],
    atSea: ["8 Nov", "10 Nov", "11 Nov", "13 Nov"],
  },
  {
    // Over New Year: the port days run into January.
    id: "9002", ship: "Symphony-of-the-Seas-1185", date: "2026-12-28", title: "7 Night Western Caribbean", departure: "Miami",
    calls: [
      { ...MIAMI, day: "28 Dec", time: "16:30", how: "Departing" },
      { ...COZUMEL, day: "31 Dec", time: "08:00 - 18:00" },
      { ...ROATAN, day: "1 Jan", time: "10:00 - 19:00" },
      { ...MIAMI, day: "4 Jan", time: "06:00", how: "Arriving" },
    ],
  },
  {
    id: "9101", ship: "Wonder-of-the-Seas-2071", date: "2027-03-14", title: "7 Night Western Caribbean", departure: "Miami",
    calls: [
      { ...MIAMI, day: "14 Mar", time: "16:30", how: "Departing" },
      { ...COZUMEL, day: "17 Mar", time: "07:00 - 17:00" },
      { ...ROATAN, day: "18 Mar", time: "08:00 - 17:00" },
      { ...COSTA_MAYA, day: "19 Mar", time: "09:00 - 17:00" },
      { ...MIAMI, day: "21 Mar", time: "06:00", how: "Arriving" },
    ],
  },
  {
    id: "9102", ship: "Wonder-of-the-Seas-2071", date: "2027-03-21", title: "7 Night Eastern Caribbean", departure: "Miami",
    calls: [
      { ...MIAMI, day: "21 Mar", time: "16:30", how: "Departing" },
      { ...LABADEE, day: "23 Mar", time: "08:00 - 17:00" },
      { ...MIAMI, day: "28 Mar", time: "06:00", how: "Arriving" },
    ],
  },
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

  // OSRM: /route/v1/driving/-122.4,37.8;-119.9,38.9?overview=full&geometries=geojson
  app.get("/osrm/route/v1/driving/:coords", async (req, reply) => {
    const { coords } = req.params as { coords: string };
    calls.push(`osrm ${coords}`);
    const pts = coords.split(";").map((p) => p.split(",").map(Number));
    if (pts.length < 2 || pts.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))) {
      return reply.code(400).send({ code: "InvalidQuery", message: "Query string malformed close to position 0" });
    }
    if (pts.some(([lng, lat]) => Math.abs(lat) > 80 || (lng > -30 && lng < -20))) {
      // Somewhere no road reaches (the mid-Atlantic stands in for that).
      return reply.code(400).send({ code: "NoRoute", message: "Impossible route between points" });
    }
    const line: number[][] = [pts[0]];
    let metres = 0;
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const bend = [(a[0] + b[0]) / 2 + (b[1] - a[1]) * 0.1, (a[1] + b[1]) / 2 - (b[0] - a[0]) * 0.1];
      line.push(bend, b);
      metres += 1.2 * 111_000 * Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return {
      code: "Ok",
      routes: [{ geometry: { type: "LineString", coordinates: line }, distance: Math.round(metres), duration: Math.round(metres / 25), legs: [] }],
      waypoints: pts.map((p) => ({ location: p, name: "" })),
    };
  });

  // CruiseMapper.
  const CM = "/cruisemapper";
  const page = (title: string, body: string) =>
    `<!doctype html><html><head><title>${title} | CruiseMapper</title></head><body>${body}</body></html>`;
  const shipLinks = (ships: FakeShip[]) => ships.map((sh) => `<a href="/ships/${sh.slug}">${sh.name}</a>`).join(" ");
  app.get(`${CM}/cruise-lines`, async (_req, reply) => {
    calls.push("cruisemapper lines");
    // The index's logo links have no text; a heading link does.
    const links = CRUISE_LINES.map((l) => `<a href="/cruise-lines/${l.slug}"><img src="/images/lines/${l.slug}.png"></a><a href="/cruise-lines/${l.slug}">${l.name}</a>`).join("");
    return reply.type("text/html").send(page("Cruise lines", `<a href="/cruise-lines">All cruise lines</a>${links}`));
  });
  app.get(`${CM}/cruise-lines/:slug`, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    calls.push(`cruisemapper line ${slug}`);
    const line = CRUISE_LINES.find((l) => l.slug === slug);
    if (!line) return reply.code(404).type("text/html").send(page("Not found", "Page not found"));
    return reply.type("text/html").send(page(line.name, `<h1>${line.name}</h1>${shipLinks(SHIPS.filter((sh) => sh.line === slug))}`));
  });
  app.get(`${CM}/ships`, async (_req, reply) => {
    calls.push("cruisemapper ships");
    return reply.type("text/html").send(page("Ships", shipLinks(SHIPS)));
  });
  app.get(`${CM}/ships/:slug`, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    if (slug === "cruise.json") return sailingDays(req, reply);
    calls.push(`cruisemapper ship ${slug}`);
    const ship = SHIPS.find((sh) => sh.slug === slug);
    if (!ship) return reply.code(404).type("text/html").send(page("Not found", "Page not found"));
    const line = CRUISE_LINES.find((l) => l.slug === ship.line)!;
    const sailings = SAILINGS.filter((sa) => ship.sailings.includes(sa.id));
    const rows = sailings.map((sa) => {
      const [year, , day] = sa.date.split("-");
      const text = `${Number(day)} ${new Date(`${sa.date}T00:00:00Z`).toLocaleString("en", { month: "short", timeZone: "UTC" })} ${year}`;
      return `<tr data-row="${sa.id}"><td class="cruiseDatetime">${text}</td><td class="cruiseTitle">${sa.title}</td><td class="cruiseDeparture">${sa.departure}</td><td class="cruisePrice">$899</td></tr>`;
    }).join("");
    const ports = [...new Map(sailings.flatMap((sa) => sa.calls).map((c) => [c.poi, c])).values()]
      .map((c) => `<a href="/ports/${c.name.split(" ")[0]}-port-${c.poi}">${c.name}</a> <a href="/ports/${c.name.split(" ")[0]}-port-${c.poi}?tab=hotels">Hotels</a>`).join(" ");
    return reply.type("text/html").send(page(ship.name, `<h1>${ship.name}</h1><img itemprop="image" src="/images/ships/${slug}.jpg">
      <a class="shipCompanyLink" href="/cruise-lines/${line.slug}">${line.name}</a>
      <table class="shipTableCruise"><tbody>${rows}</tbody></table><div class="ports">${ports}</div>`));
  });
  const xhr = (req: { headers: Record<string, unknown> }) => req.headers["x-requested-with"] === "XMLHttpRequest";
  const sailingOf = (req: { query: unknown }) => SAILINGS.find((sa) => sa.id === (req.query as { id?: string }).id);
  // The day-by-day ports.
  async function sailingDays(req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
    calls.push(`cruisemapper days ${(req.query as { id?: string }).id}`);
    const sa = sailingOf(req);
    if (!xhr(req) || !sa) return reply.redirect(`${CM}/ships/${sa?.ship ?? ""}`);
    const rows = [
      ...sa.calls.map((c) => ({ day: c.day, html: `<td class="date">${c.day} ${c.time}</td><td class="text">${c.how ? `${c.how} ` : ""}<a href="/ports/${c.name.split(" ")[0]}-port-${c.poi}">${c.name}</a> <a href="/ports/${c.name.split(" ")[0]}-port-${c.poi}?tab=map">Map</a></td>` })),
      ...(sa.atSea ?? []).map((day) => ({ day, html: `<td class="date">${day}</td><td class="text">At sea</td>` })),
    ];
    // In date order, as on the site ("28 Dec" before "1 Jan").
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const first = MONTHS.indexOf(sa.calls[0].day.split(" ")[1]);
    const key = (day: string) => {
      const [dd, mon] = day.split(" ");
      const mi = MONTHS.indexOf(mon);
      return (mi < first ? mi + 12 : mi) * 31 + Number(dd);
    };
    rows.sort((a, b) => key(a.day) - key(b.day));
    const html = `<table class="cruiseExpand"><tbody>${rows.map((r) => `<tr>${r.html}</tr>`).join("")}</tbody></table>`;
    return { result: html };
  }
  // A page that sends you somewhere else entirely.
  app.get(`${CM}/elsewhere`, async (_req, reply) => reply.redirect("http://example.com/"));
  // The track and the ports' coordinates.
  app.get(`${CM}/map/cruise.json`, async (req, reply) => {
    calls.push(`cruisemapper track ${(req.query as { id?: string }).id}`);
    const sa = sailingOf(req);
    if (!xhr(req) || !sa) return reply.redirect(`${CM}/ships/${sa?.ship ?? ""}`);
    const year = sa.date.slice(0, 4);
    return {
      points: sa.calls.flatMap((c, i) => (i ? [[(sa.calls[i - 1].lng + c.lng) / 2, (sa.calls[i - 1].lat + c.lat) / 2 + 0.3], [c.lng, c.lat]] : [[c.lng, c.lat]])),
      ports: sa.calls.map((c, i) => ({ poi: c.poi, lat: String(c.lat), lon: String(c.lng), dep_datetime: i === 0 ? `${year}-${sa.date.slice(5, 7)}-${sa.date.slice(8, 10)} 16:30:00` : null })),
    };
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, calls, down, places, close: () => app.close() };
}
