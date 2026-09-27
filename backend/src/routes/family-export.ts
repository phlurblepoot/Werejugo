import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuthOrTicket, requireOwner } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { familyArchive } from "../lib/family-export.js";
import { slugify } from "../lib/storage.js";

/** "Download our data": one family's rows and files, for its owners. */
export async function familyExportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/family/export", { preHandler: [requireAuthOrTicket("family-export"), requireOwner] }, async (req, reply) => {
    const fam = (await query<{ name: string }>("SELECT name FROM families WHERE id = $1", [req.user.familyId])).rows[0];
    const { stream, cleanup } = await familyArchive(req.user.familyId, fam.name);
    await audit({ actorId: req.user.id, action: "family.exported", familyId: req.user.familyId });
    stream.on("close", () => { void cleanup(); });
    stream.on("error", () => { void cleanup(); });
    const date = new Date().toISOString().slice(0, 10);
    reply.header("Content-Type", "application/gzip");
    reply.header("Content-Disposition", `attachment; filename="werejugo-${slugify(fam.name)}-${date}.tar.gz"`);
    return reply.send(stream);
  });
}
