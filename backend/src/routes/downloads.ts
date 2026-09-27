import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireAuth, signDownloadTicket, type DownloadPurpose } from "../lib/auth.js";
import { forbidden } from "../lib/errors.js";

const PATHS: Record<DownloadPurpose, string> = {
  backup: "/api/backup",
  "family-export": "/api/family/export",
};

/**
 * Big archives are downloaded by following a plain link, so the browser streams
 * them to disk instead of holding them in memory. The link carries a two-minute
 * ticket that is good for that one kind of download only.
 */
export async function downloadRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/downloads/ticket", { preHandler: requireAuth }, async (req) => {
    const { purpose } = z.object({ purpose: z.enum(["backup", "family-export"]) }).parse(req.body);
    if (purpose === "backup" && !req.user.isAdmin) throw forbidden("Only the server admin can do this");
    if (purpose === "family-export" && req.user.role !== "owner") throw forbidden("Only a family owner can do this");
    const ticket = signDownloadTicket(app, req.user, purpose);
    return { url: `${PATHS[purpose]}?ticket=${encodeURIComponent(ticket)}` };
  });
}
