import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { tx, query } from "../db/pool.js";
import { hashPassword, verifyPassword, requireAuth, signToken, type Role } from "../lib/auth.js";
import { createFamilyWithOwner, EmailTakenError, publicUser, USER_COLUMNS, type UserRow } from "../lib/accounts.js";
import { audit } from "../lib/audit.js";

const password = z.string().min(8, "Use at least 8 characters").max(200);

const setupSchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(80),
  password,
  familyName: z.string().trim().min(1).max(120),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword("werejugo-timing-equalizer"));

async function userCount(): Promise<number> {
  const { rows } = await query<{ n: number }>("SELECT count(*)::int AS n FROM users");
  return rows[0].n;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Public: what the sign-in page should offer. */
  app.get("/api/auth/config", async () => ({ firstRun: (await userCount()) === 0 }));

  /** First run only: create the server admin and their family. */
  app.post("/api/auth/setup", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const user = await tx(async (client) => {
        // Serialize so two simultaneous setups can't both succeed.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('werejugo:setup'))");
        const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM users");
        if (rows[0].n > 0) throw new Error("ALREADY_SET_UP");
        const u = await createFamilyWithOwner(client, { ...parsed.data, isAdmin: true });
        await audit({ actorId: u.id, action: "server.setup", familyId: u.family_id, target: parsed.data.familyName }, client);
        return u;
      });
      return reply.send({ token: signToken(reply, user), user: publicUser(user) });
    } catch (err) {
      if (err instanceof Error && err.message === "ALREADY_SET_UP") {
        return reply.code(403).send({ error: "This server is already set up. Ask the server admin for an invite." });
      }
      if (err instanceof EmailTakenError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  /** Retired: families are created by admin invite, members join by invite link. */
  app.post("/api/auth/register", async (_req, reply) =>
    reply.code(410).send({ error: "Sign-up is by invite link only. Ask your family owner or the server admin for one." }));

  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { rows } = await query<UserRow & { password_hash: string; user_disabled: boolean; family_disabled: boolean }>(
      `SELECT u.id, u.family_id, u.email, u.display_name, u.role, u.color, u.is_admin, u.token_version, u.password_hash,
              u.disabled_at IS NOT NULL AS user_disabled, f.disabled_at IS NOT NULL AS family_disabled
         FROM users u JOIN families f ON f.id = u.family_id
        WHERE u.email = $1`,
      [parsed.data.email.toLowerCase()],
    );
    const user = rows[0];
    // Compare against a dummy hash for unknown emails so response time doesn't
    // reveal which accounts exist.
    const ok = await verifyPassword(parsed.data.password, user?.password_hash ?? (await dummyHash()));
    if (!user || !ok) return reply.code(401).send({ error: "Invalid email or password" });
    if (user.user_disabled) return reply.code(403).send({ error: "This account has been disabled" });
    if (user.family_disabled && !user.is_admin) {
      return reply.code(403).send({ error: "This family's account has been disabled by the server admin" });
    }
    await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
    return reply.send({ token: signToken(reply, user), user: publicUser(user) });
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (req, reply) => {
    const auth = req.user;
    const { rows } = await query<UserRow & { home_family_name: string }>(
      `SELECT ${USER_COLUMNS.split(", ").map((c) => `u.${c}`).join(", ")}, f.name AS home_family_name
         FROM users u JOIN families f ON f.id = u.family_id WHERE u.id = $1`,
      [auth.id],
    );
    const u = rows[0];
    if (!u) return reply.code(401).send({ error: "Unauthorized" });
    const fam = (await query<{ id: string; name: string }>("SELECT id, name FROM families WHERE id = $1", [auth.familyId])).rows[0];
    return {
      user: { ...publicUser(u), familyId: auth.familyId, role: auth.role as Role },
      family: { id: fam.id, name: fam.name },
      adminView: auth.adminView ? { homeFamilyId: u.family_id, homeFamilyName: u.home_family_name } : null,
    };
  });
}
