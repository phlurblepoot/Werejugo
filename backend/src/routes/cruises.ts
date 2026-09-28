import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth.js";
import { scopeOf } from "../lib/access.js";
import { badRequest } from "../lib/errors.js";
import { ymd } from "../lib/validate.js";
import { proposeCruise } from "../lib/cruiseFromPhotos.js";

/** Cruises built from my family's photos. */
export async function cruiseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/cruises/from-photos", async (req) => {
    const { from, to } = z.object({ from: ymd, to: ymd }).parse(req.body);
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (days < 0) throw badRequest("The last day can't be before the first");
    if (days > 60) throw badRequest("A cruise from photos can be at most 60 days");
    return proposeCruise(scopeOf(req), { from, to });
  });
}
