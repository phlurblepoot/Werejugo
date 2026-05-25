import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { lookupFlightByCodes, lookupFlightByNumber } from "../services/flightLookup.js";
import { diagnoseCruise, findCruise, lookupCruiseByPorts, lookupCruiseByShip } from "../services/cruiseLookup.js";
import { findPort, searchAirports, searchPorts, searchPlaces } from "../services/places.js";

const flightSchema = z.union([
  z.object({ codes: z.array(z.string().min(2).max(5)).min(2) }),
  z.object({ flightNumber: z.string().min(2).max(10), date: z.string() }),
]);

const cruiseSchema = z.union([
  z.object({ ports: z.array(z.string().min(1)).min(1) }),
  z.object({ ship: z.string().min(2) }),
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

  app.post("/api/lookup/cruise", async (req, reply) => {
    const parsed = cruiseSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const result = "ports" in b ? await lookupCruiseByPorts(b.ports) : await lookupCruiseByShip(b.ship);
    return result;
  });

  // Find a ship (via its cruise line) and return its sailings + ports of call.
  app.post("/api/lookup/cruise/find", async (req, reply) => {
    const parsed = z.object({ line: z.string().optional(), ship: z.string().min(2) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return findCruise(parsed.data);
  });

  // Diagnostic: shows what this server actually receives from CruiseMapper, so the
  // scraper can be tuned to the real HTML. POST { "query": "symphony" } or { "url": "..." }.
  app.post("/api/lookup/cruise/diagnose", async (req) => {
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

  app.get("/api/geo/search", async (req) => {
    const q = (req.query as { q?: string }).q ?? "";
    if (q.length < 3) return [];
    return searchPlaces(q);
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
