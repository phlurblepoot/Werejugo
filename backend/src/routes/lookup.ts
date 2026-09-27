import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { lookupFlightByCodes, lookupFlightByNumber } from "../services/flightLookup.js";
import {
  diagnoseCruise,
  findCruise,
  getSailingDetail,
  searchCruiseLines,
  searchCruiseShips,
} from "../services/cruiseLookup.js";
import { findPort, searchAirports, searchPorts, searchPlaces } from "../services/places.js";

const flightSchema = z.union([
  z.object({ codes: z.array(z.string().min(2).max(5)).min(2) }),
  z.object({ flightNumber: z.string().min(2).max(10), date: z.string() }),
]);

export async function lookupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/lookup/flight", async (req, reply) => {
    const parsed = flightSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const result =
      "codes" in b ? await lookupFlightByCodes(b.codes) : await lookupFlightByNumber(b.flightNumber, b.date);
    return result;
  });

  // Find a ship (via its cruise line, or an exact ship URL) → sailings + ports.
  app.post("/api/lookup/cruise/find", async (req, reply) => {
    const parsed = z
      .object({ line: z.string().optional(), ship: z.string().optional(), shipUrl: z.string().url().optional() })
      .refine((d) => Boolean(d.ship || d.shipUrl), { message: "ship or shipUrl required" })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return findCruise(parsed.data);
  });

  // Full itinerary for one sailing (ports on their dates + the real sailed route).
  app.post("/api/lookup/cruise/sailing", async (req, reply) => {
    const parsed = z.object({ id: z.string().regex(/^\d+$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "numeric sailing id required" });
    return getSailingDetail(parsed.data.id, parsed.data.date);
  });

  // Autocomplete for cruise lines and ships (ships require a cruise line).
  app.get("/api/lookup/cruise/lines", async (req) => {
    const q = (req.query as { q?: string }).q ?? "";
    return searchCruiseLines(q);
  });
  app.get("/api/lookup/cruise/ships", async (req) => {
    const { q, line } = req.query as { q?: string; line?: string };
    return searchCruiseShips(q ?? "", line);
  });

  // Diagnostic: shows what this server actually receives from CruiseMapper, so the
  // scraper can be tuned to the real HTML. POST { "query": "symphony" } or { "url": "..." }.
  app.post("/api/lookup/cruise/diagnose", { preHandler: requireAdmin }, async (req) => {
    const b = (req.body ?? {}) as { url?: string; query?: string; selector?: string; raw?: boolean; maxLen?: number };
    return diagnoseCruise({ url: b.url, query: b.query, selector: b.selector, raw: b.raw, maxLen: b.maxLen });
  });

  // Autocomplete helpers used by the entry forms.
  app.get("/api/geo/airports", async (req) => {
    const q = (req.query as { q?: string }).q ?? "";
    if (q.length < 2) return [];
    return searchAirports(q);
  });

  app.get("/api/geo/ports", async (req) => {
    const q = (req.query as { q?: string }).q ?? "";
    if (q.length < 2) return [];
    return searchPorts(q);
  });

  // As you type (Photon); `near=lng,lat` (the map's centre) puts nearby places first.
  app.get("/api/geo/search", async (req) => {
    const { q = "", near } = req.query as { q?: string; near?: string };
    if (q.trim().length < 3) return [];
    const [lng, lat] = (near ?? "").split(",").map(Number);
    const ok = Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    return searchPlaces(q, ok ? { near: { lng, lat } } : {});
  });

  // Resolve a single port/place name to coordinates (dataset, then geocoder).
  app.get("/api/geo/resolve", async (req, reply) => {
    const q = (req.query as { q?: string }).q ?? "";
    if (q.length < 2) return reply.code(400).send({ error: "query too short" });
    const place = await findPort(q);
    if (!place) return reply.code(404).send({ error: "not found" });
    return place;
  });
}
