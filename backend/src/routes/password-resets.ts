import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { hashPassword } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { hashToken } from "../lib/tokens.js";

const GONE = "This reset link has expired or was already used. Ask for a new one.";

/** Public: use a one-time password reset link. */
export async function passwordResetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/password-resets/:token", async (req, reply) => {
    const { rows } = await query<{ display_name: string; email: string }>(
      `SELECT u.display_name, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now()`,
      [hashToken((req.params as { token: string }).token)],
    );
    if (!rows[0]) return reply.code(404).send({ error: GONE });
    return { displayName: rows[0].display_name, email: rows[0].email };
  });

  app.post("/api/password-resets/:token", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = z.object({ password: z.string().min(8, "Use at least 8 characters").max(200) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const hash = await hashPassword(parsed.data.password);
    const done = await tx(async (client) => {
      const { rows } = await client.query<{ id: string; user_id: string; family_id: string }>(
        `SELECT r.id, r.user_id, u.family_id FROM password_resets r JOIN users u ON u.id = r.user_id
          WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now() FOR UPDATE OF r`,
        [hashToken((req.params as { token: string }).token)],
      );
      const r = rows[0];
      if (!r) return false;
      await client.query("UPDATE password_resets SET used_at = now() WHERE id = $1", [r.id]);
      // New password; every existing session is signed out.
      await client.query("UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1", [r.user_id, hash]);
      await audit({ actorId: r.user_id, action: "password.reset_used", familyId: r.family_id }, client);
      return true;
    });
    if (!done) return reply.code(404).send({ error: GONE });
    return { ok: true };
  });
}
