import { customAlphabet } from "nanoid";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

const makeToken = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 20);

const createSchema = z.object({
  targetType: z.enum(["trip", "album"]),
  targetId: z.string().uuid(),
});

/** A trip and its album (its photo gallery) both resolve to a trip the family owns. */
async function ownsTarget(familyId: string, targetType: string, targetId: string): Promise<boolean> {
  // Both 'trip' and 'album' targets reference a trip id (an album is that trip's gallery).
  const { rowCount } = await query("SELECT 1 FROM trips WHERE id = $1 AND family_id = $2", [targetId, familyId]);
  return Boolean(rowCount);
}

export async function shareRoutes(app: FastifyInstance): Promise<void> {
  // --- Authenticated management ---

  app.post("/api/shares", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid share target" });
    const { targetType, targetId } = parsed.data;
    if (!(await ownsTarget(req.user.familyId, targetType, targetId))) {
      return reply.code(404).send({ error: "Target not found" });
    }
    const { rows } = await query<any>(
      `INSERT INTO share_links (token, target_type, target_id, family_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, token, target_type, target_id, created_at`,
      [makeToken(), targetType, targetId, req.user.familyId, req.user.id],
    );
    const r = rows[0];
    return reply.code(201).send({ id: r.id, token: r.token, targetType: r.target_type, targetId: r.target_id, createdAt: r.created_at });
  });

  app.get("/api/shares", { preHandler: requireAuth }, async (req, reply) => {
    const { targetType, targetId } = req.query as { targetType?: string; targetId?: string };
    if (!targetType || !targetId) return reply.code(400).send({ error: "targetType and targetId are required" });
    const { rows } = await query<any>(
      `SELECT id, token, target_type, target_id, created_at FROM share_links
       WHERE family_id = $1 AND target_type = $2 AND target_id = $3 ORDER BY created_at DESC`,
      [req.user.familyId, targetType, targetId],
    );
    return rows.map((r) => ({ id: r.id, token: r.token, targetType: r.target_type, targetId: r.target_id, createdAt: r.created_at }));
  });

  app.delete("/api/shares/:id", { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM share_links WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });

  // --- Public, read-only (no auth) --- implemented in Task 4
  app.get("/api/share/:token", async (_req, reply) => {
    return reply.code(404).send({ error: "Link not found or revoked" });
  });
}
