import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { signToken } from "../lib/auth.js";
import { createFamilyWithOwner, createUser, EmailTakenError, publicUser } from "../lib/accounts.js";
import { findUsableInvite } from "../lib/links-onetime.js";
import { audit } from "../lib/audit.js";
import { hashToken } from "../lib/tokens.js";
import { provisionNewFamily } from "../lib/immich/provision.js";

const acceptSchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  familyName: z.string().trim().min(1).max(120).optional(),
});

const GONE = "This invite link has expired, was already used, or was cancelled. Ask for a new one.";

/** Public: look at and accept one-time invite links. */
export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/invites/:token", async (req, reply) => {
    const invite = await findUsableInvite((req.params as { token: string }).token);
    if (!invite) return reply.code(404).send({ error: GONE });
    const admin = (await query<{ display_name: string }>(
      "SELECT display_name FROM users WHERE is_admin ORDER BY created_at ASC LIMIT 1")).rows[0];
    return {
      kind: invite.kind,
      familyName: invite.family_name,
      role: invite.role,
      invitedBy: invite.created_by_name,
      expiresAt: invite.expires_at.toISOString(),
      adminName: admin?.display_name ?? null,
    };
  });

  app.post("/api/invites/:token/accept", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;
    try {
      const user = await tx(async (client) => {
        // Lock the invite row so it can only be used once, even under a race.
        const { rows } = await client.query<{ id: string; kind: "family" | "member"; family_id: string | null; role: "owner" | "member" }>(
          `SELECT id, kind, family_id, role FROM invites
            WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
            FOR UPDATE`,
          [hashToken(token)],
        );
        const invite = rows[0];
        if (!invite) throw new Error("GONE");
        let u;
        if (invite.kind === "family") {
          if (!body.familyName) throw new Error("FAMILY_NAME");
          u = await createFamilyWithOwner(client, { ...body, familyName: body.familyName, signedIn: true });
        } else {
          u = await createUser(client, { ...body, familyId: invite.family_id!, role: invite.role, signedIn: true });
        }
        await client.query("UPDATE invites SET used_at = now(), used_by = $2 WHERE id = $1", [invite.id, u.id]);
        await audit({
          actorId: u.id, action: invite.kind === "family" ? "invite.family_created" : "invite.member_joined",
          familyId: u.family_id, target: u.email, details: { inviteId: invite.id, role: u.role },
        }, client);
        return { ...u, newFamily: invite.kind === "family" };
      });
      // A new family gets its Immich account in the background (if Immich is set up).
      if (user.newFamily) provisionNewFamily(user.family_id, req.log);
      return reply.send({ token: signToken(reply, user), user: publicUser(user) });
    } catch (err) {
      if (err instanceof Error && err.message === "GONE") return reply.code(404).send({ error: GONE });
      if (err instanceof Error && err.message === "FAMILY_NAME") return reply.code(400).send({ error: "Give your family a name" });
      if (err instanceof EmailTakenError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });
}
