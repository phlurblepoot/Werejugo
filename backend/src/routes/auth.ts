import { customAlphabet } from "nanoid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { tx, query } from "../db/pool.js";
import { hashPassword, verifyPassword, requireAuth, type AuthUser } from "../lib/auth.js";
import { isInstanceOwner } from "../lib/instance.js";
import { config } from "../config.js";

const inviteCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);

const registerSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("create"),
    email: z.string().email(),
    displayName: z.string().min(1).max(80),
    password: z.string().min(8).max(200),
    familyName: z.string().min(1).max(120),
  }),
  z.object({
    mode: z.literal("join"),
    email: z.string().email(),
    displayName: z.string().min(1).max(80),
    password: z.string().min(8).max(200),
    inviteCode: z.string().min(4).max(16),
  }),
]);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface UserRow {
  id: string;
  family_id: string;
  email: string;
  display_name: string;
  role: "owner" | "member";
  color: string;
}

async function familyCount(): Promise<number> {
  const { rows } = await query<{ n: number }>("SELECT count(*)::int AS n FROM families");
  return rows[0].n;
}

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword("werejugo-timing-equalizer"));

const SIGNUP_CLOSED = "New families can't sign up on this server. Ask a family owner for their invite code to join.";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Public: what the login page should offer. */
  app.get("/api/auth/config", async () => {
    const firstRun = (await familyCount()) === 0;
    return { firstRun, signupOpen: firstRun || config.allowSignup };
  });

  app.post("/api/auth/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;

    try {
      const user = await tx(async (client) => {
        let familyId: string;
        let role: "owner" | "member";

        if (body.mode === "create") {
          // Serialize family creation so two simultaneous first-run signups
          // can't both slip through, then re-check inside the transaction.
          await client.query("SELECT pg_advisory_xact_lock(hashtext('werejugo:create-family'))");
          const { rows: existing } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM families");
          if (existing[0].n > 0 && !config.allowSignup) throw new Error("SIGNUP_CLOSED");
          const fam = await client.query<{ id: string }>(
            "INSERT INTO families (name, invite_code) VALUES ($1, $2) RETURNING id",
            [body.familyName, inviteCode()],
          );
          familyId = fam.rows[0].id;
          role = "owner";
        } else {
          const fam = await client.query<{ id: string }>(
            "SELECT id FROM families WHERE invite_code = $1",
            [body.inviteCode.toUpperCase()],
          );
          if (!fam.rows[0]) throw new Error("INVALID_INVITE");
          familyId = fam.rows[0].id;
          role = "member";
        }

        // Checked only after the signup gate / invite code, so a stranger can't
        // use this endpoint to discover which emails have accounts.
        const taken = await client.query("SELECT 1 FROM users WHERE email = $1", [body.email.toLowerCase()]);
        if (taken.rowCount) throw new Error("EMAIL_TAKEN");

        const hash = await hashPassword(body.password);
        const u = await client.query<UserRow>(
          `INSERT INTO users (family_id, email, display_name, password_hash, role)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, family_id, email, display_name, role, color`,
          [familyId, body.email.toLowerCase(), body.displayName, hash, role],
        );

        // Give a brand-new family a starter map set.
        if (body.mode === "create") {
          await client.query(
            `INSERT INTO map_sets (family_id, name, description, created_by)
             VALUES ($1, 'Our Map', 'Where we have been', $2)`,
            [familyId, u.rows[0].id],
          );
        }
        return u.rows[0];
      });

      const token = await reply.jwtSign(toAuthUser(user));
      return reply.send({ token, user: publicUser(user) });
    } catch (err) {
      if (err instanceof Error && err.message === "INVALID_INVITE") {
        return reply.code(400).send({ error: "Invalid invite code" });
      }
      if (err instanceof Error && err.message === "SIGNUP_CLOSED") {
        return reply.code(403).send({ error: SIGNUP_CLOSED });
      }
      if (err instanceof Error && err.message === "EMAIL_TAKEN") {
        return reply.code(409).send({ error: "Email already registered" });
      }
      throw err;
    }
  });

  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { rows } = await query<UserRow & { password_hash: string }>(
      `SELECT id, family_id, email, display_name, role, color, password_hash
       FROM users WHERE email = $1`,
      [parsed.data.email.toLowerCase()],
    );
    const user = rows[0];
    // Compare against a dummy hash for unknown emails so response time doesn't
    // reveal which accounts exist.
    const hash = user?.password_hash ?? (await dummyHash());
    const ok = await verifyPassword(parsed.data.password, hash);
    if (!user || !ok) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    const token = await reply.jwtSign(toAuthUser(user));
    return reply.send({ token, user: publicUser(user) });
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (req, reply) => {
    const auth = req.user;
    const { rows } = await query<UserRow & { family_name: string; invite_code: string }>(
      `SELECT u.id, u.family_id, u.email, u.display_name, u.role, u.color,
              f.name AS family_name, f.invite_code
       FROM users u JOIN families f ON f.id = u.family_id
       WHERE u.id = $1`,
      [auth.id],
    );
    const u = rows[0];
    // The account may have been deleted (e.g. by a restore) while the token lives on.
    if (!u) return reply.code(401).send({ error: "Unauthorized" });
    return {
      user: { ...publicUser(u), isInstanceOwner: await isInstanceOwner(auth) },
      family: { id: u.family_id, name: u.family_name, inviteCode: u.invite_code },
    };
  });
}

function toAuthUser(u: UserRow): AuthUser {
  return { id: u.id, familyId: u.family_id, role: u.role };
}

function publicUser(u: UserRow) {
  return {
    id: u.id,
    familyId: u.family_id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    color: u.color,
  };
}
