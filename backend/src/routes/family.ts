import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAuth, requireOwner } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { createInvite, createResetLink } from "../lib/links-onetime.js";

const UUID = z.string().uuid();
const inviteSchema = z.object({
  role: z.enum(["owner", "member"]).default("member"),
  note: z.string().trim().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

interface MemberRow {
  id: string;
  display_name: string;
  email: string;
  role: "owner" | "member";
  color: string;
  is_admin: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

/** Load a member of the caller's family, or send 404. */
async function memberOf(req: FastifyRequest, reply: FastifyReply): Promise<MemberRow | null> {
  const id = (req.params as { id: string }).id;
  if (!UUID.safeParse(id).success) {
    await reply.code(404).send({ error: "Member not found" });
    return null;
  }
  const { rows } = await query<MemberRow>(
    `SELECT id, display_name, email, role, color, is_admin, last_login_at, created_at
       FROM users WHERE id = $1 AND family_id = $2`,
    [id, req.user.familyId],
  );
  if (!rows[0]) await reply.code(404).send({ error: "Member not found" });
  return rows[0] ?? null;
}

async function ownerCount(familyId: string): Promise<number> {
  const { rows } = await query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE family_id = $1 AND role = 'owner'", [familyId]);
  return rows[0].n;
}

/** The caller's family: its members and, for owners, invites and member management. */
export async function familyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  const ownerOnly = { preHandler: requireOwner };

  app.get("/api/family", async (req) => {
    const fam = (await query<{ id: string; name: string; created_at: Date }>(
      "SELECT id, name, created_at FROM families WHERE id = $1", [req.user.familyId])).rows[0];
    const members = (await query<MemberRow>(
      `SELECT id, display_name, email, role, color, is_admin, last_login_at, created_at
         FROM users WHERE family_id = $1 AND disabled_at IS NULL
        ORDER BY role = 'owner' DESC, display_name ASC`,
      [req.user.familyId])).rows;
    const invites = req.user.role === "owner"
      ? (await query<{ id: string; role: string; note: string; created_at: Date; expires_at: Date; created_by_name: string | null }>(
          `SELECT i.id, i.role, i.note, i.created_at, i.expires_at, u.display_name AS created_by_name
             FROM invites i LEFT JOIN users u ON u.id = i.created_by
            WHERE i.kind = 'member' AND i.family_id = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
            ORDER BY i.created_at DESC`,
          [req.user.familyId])).rows
      : [];
    return {
      family: { id: fam.id, name: fam.name, createdAt: fam.created_at },
      members: members.map((m) => ({
        id: m.id, displayName: m.display_name, email: m.email, role: m.role, color: m.color,
        isAdmin: m.is_admin, lastLoginAt: m.last_login_at, joinedAt: m.created_at, isYou: m.id === req.user.id,
      })),
      invites: invites.map((i) => ({
        id: i.id, role: i.role, note: i.note, createdAt: i.created_at, expiresAt: i.expires_at, createdByName: i.created_by_name,
      })),
    };
  });

  app.patch("/api/family", ownerOnly, async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(120) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await query("UPDATE families SET name = $2 WHERE id = $1", [req.user.familyId, parsed.data.name]);
    await audit({ actorId: req.user.id, action: "family.renamed", familyId: req.user.familyId, target: parsed.data.name });
    return { ok: true };
  });

  app.post("/api/family/invites", ownerOnly, async (req, reply) => {
    const parsed = inviteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const link = await createInvite({
      kind: "member", familyId: req.user.familyId, role: parsed.data.role, note: parsed.data.note,
      createdBy: req.user.id, days: parsed.data.expiresInDays,
    });
    await audit({ actorId: req.user.id, action: "invite.member_created", familyId: req.user.familyId, details: { inviteId: link.id, role: parsed.data.role } });
    return reply.code(201).send(link);
  });

  app.delete("/api/family/invites/:id", ownerOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!UUID.safeParse(id).success) return reply.code(404).send({ error: "Invite not found" });
    const { rowCount } = await query(
      "UPDATE invites SET revoked_at = now() WHERE id = $1 AND family_id = $2 AND kind = 'member' AND used_at IS NULL AND revoked_at IS NULL",
      [id, req.user.familyId]);
    if (!rowCount) return reply.code(404).send({ error: "Invite not found" });
    await audit({ actorId: req.user.id, action: "invite.revoked", familyId: req.user.familyId, details: { inviteId: id } });
    return reply.code(204).send();
  });

  app.patch("/api/family/members/:id", ownerOnly, async (req, reply) => {
    const parsed = z.object({ role: z.enum(["owner", "member"]) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const m = await memberOf(req, reply);
    if (!m) return;
    if (m.role === "owner" && parsed.data.role === "member" && (await ownerCount(req.user.familyId)) <= 1) {
      return reply.code(400).send({ error: "A family needs at least one owner" });
    }
    // The role takes effect immediately (it's read from the database); the bump
    // just makes sure no stale token keeps working with the old one.
    await query("UPDATE users SET role = $2, token_version = token_version + 1 WHERE id = $1", [m.id, parsed.data.role]);
    await audit({ actorId: req.user.id, action: "member.role_changed", familyId: req.user.familyId, target: m.email, details: { role: parsed.data.role } });
    return { ok: true };
  });

  app.delete("/api/family/members/:id", ownerOnly, async (req, reply) => {
    const m = await memberOf(req, reply);
    if (!m) return;
    if (m.id === req.user.id) return reply.code(400).send({ error: "You can't remove yourself" });
    if (m.is_admin && !req.user.isAdmin) return reply.code(403).send({ error: "Only the server admin can remove an admin" });
    if (m.role === "owner" && (await ownerCount(req.user.familyId)) <= 1) {
      return reply.code(400).send({ error: "A family needs at least one owner" });
    }
    try {
      await tx(async (client) => {
        if (m.is_admin) {
          const admins = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE is_admin")).rows[0].n;
          if (admins <= 1) throw new Error("LAST_ADMIN");
        }
        await client.query("DELETE FROM users WHERE id = $1", [m.id]);
        await audit({ actorId: req.user.id, action: "member.removed", familyId: req.user.familyId, target: m.email }, client);
      });
    } catch (err) {
      if (err instanceof Error && err.message === "LAST_ADMIN") return reply.code(400).send({ error: "The server needs at least one admin" });
      throw err;
    }
    return reply.code(204).send();
  });

  app.post("/api/family/members/:id/reset-link", ownerOnly, async (req, reply) => {
    const m = await memberOf(req, reply);
    if (!m) return;
    // A family owner must not be able to take over a server admin's account.
    if (m.is_admin && !req.user.isAdmin) return reply.code(403).send({ error: "Only the server admin can reset an admin's password" });
    const link = await createResetLink(m.id, req.user.id);
    await audit({ actorId: req.user.id, action: "password.reset_link_created", familyId: req.user.familyId, target: m.email });
    return reply.code(201).send(link);
  });
}
