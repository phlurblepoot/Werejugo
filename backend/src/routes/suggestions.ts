import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { scopeOf } from "../lib/access.js";
import { requireAuth } from "../lib/auth.js";
import { badRequest } from "../lib/errors.js";
import { enqueueAlbumSync } from "../lib/jobs.js";
import { applySuggestion, dismissSuggestion, forLibrary, forTrip, forVisit, type Suggestion } from "../lib/suggest.js";
import { uuid } from "../lib/validate.js";

/** Suggestions from photos (lib/suggest.ts): for a trip, a place, or the whole library. */

// The photos' ids stay on the server; the browser gets the count and a few thumbnails.
const dto = ({ mediaIds: _ids, ...s }: Suggestion) => s;
const keySchema = z.string().min(3).max(200);

export async function suggestionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/suggestions", async (req) => {
    const { for: target } = z.object({ for: z.string().max(80) }).parse(req.query);
    const scope = scopeOf(req);
    const [type, id] = target.split(":");
    if (type === "library" && !id) return { items: (await forLibrary(scope)).map(dto) };
    if (!uuid.safeParse(id).success) throw badRequest("Use for=trip:<id>, visit:<id> or library");
    if (type === "trip") return { items: (await forTrip(scope, id)).map(dto) };
    if (type === "visit") return { items: (await forVisit(scope, id)).map(dto) };
    throw badRequest("Use for=trip:<id>, visit:<id> or library");
  });

  app.post("/api/suggestions/apply", async (req) => {
    const b = z.object({ key: keySchema, name: z.string().trim().max(120).optional() }).parse(req.body);
    const scope = scopeOf(req);
    const r = await applySuggestion(scope, b.key, { name: b.name });
    if (r.attached || r.tripId) enqueueAlbumSync(scope.familyId); // photos put in a trip go in its album
    return r;
  });

  app.post("/api/suggestions/dismiss", async (req, reply) => {
    const b = z.object({ key: keySchema }).parse(req.body);
    await dismissSuggestion(scopeOf(req), b.key);
    return reply.code(204).send();
  });
}
