import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

/** Per-family settings (pin appearance defaults, etc.) stored as free-form JSON. */
export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/settings", async (req) => {
    const { rows } = await query<{ settings: unknown }>("SELECT settings FROM families WHERE id = $1", [
      req.user.familyId,
    ]);
    return rows[0]?.settings ?? {};
  });

  app.put("/api/settings", async (req, reply) => {
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: "Settings must be a JSON object" });
    }
    const json = JSON.stringify(body);
    if (json.length > 50_000) return reply.code(400).send({ error: "Settings too large" });
    const { rows } = await query<{ settings: unknown }>(
      "UPDATE families SET settings = $2 WHERE id = $1 RETURNING settings",
      [req.user.familyId, json],
    );
    if (!rows[0]) return reply.code(404).send({ error: "Family not found" });
    return rows[0].settings;
  });
}
