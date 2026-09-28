import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth.js";
import { unavailable } from "../lib/errors.js";
import { lat, lng } from "../lib/geojson.js";
import { roadPath, RoadRouteError } from "../services/roadRoute.js";
import { seaPath } from "../services/seaRoute.js";

// A route through stops, in order: 2 to 60 of them, [lng, lat] each.
const pointsSchema = z.object({ points: z.array(z.tuple([lng, lat])).min(2).max(60) });

/** Lines for the map: along roads (road trips) or across water (cruises). */
export async function routingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/routes/sea", async (req) => {
    const { points } = pointsSchema.parse(req.body);
    return { source: "sea", ...(await seaPath(points)) };
  });

  app.post("/api/routes/road", async (req) => {
    const { points } = pointsSchema.parse(req.body);
    try {
      return { source: "road", ...(await roadPath(points)) };
    } catch (err) {
      if (err instanceof RoadRouteError) throw unavailable(err.message);
      throw err;
    }
  });
}
