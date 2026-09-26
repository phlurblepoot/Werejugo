import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { hashPassword, requireAuth, signToken, verifyPassword } from "../lib/auth.js";
import { publicUser, USER_COLUMNS, type UserRow } from "../lib/accounts.js";
import { audit } from "../lib/audit.js";

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Use at least 8 characters").max(200),
});

/** The signed-in user's own account. */
export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.patch("/api/account", async (req, reply) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { rows } = await query<UserRow>(
      `UPDATE users SET display_name = COALESCE($2, display_name), color = COALESCE($3, color)
        WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [req.user.id, parsed.data.displayName ?? null, parsed.data.color ?? null],
    );
    return { user: publicUser(rows[0]) };
  });

  app.post("/api/account/password", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { rows } = await query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    if (!rows[0] || !(await verifyPassword(parsed.data.currentPassword, rows[0].password_hash))) {
      return reply.code(400).send({ error: "Your current password isn't right" });
    }
    const hash = await hashPassword(parsed.data.newPassword);
    // Changing the password signs out every other session; this one gets a fresh token.
    const updated = await query<UserRow>(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [req.user.id, hash],
    );
    await audit({ actorId: req.user.id, action: "password.changed", familyId: updated.rows[0].family_id });
    return { token: signToken(reply, updated.rows[0]) };
  });

  app.post("/api/account/sign-out-everywhere", async (req) => {
    await query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [req.user.id]);
    return { ok: true };
  });
}
