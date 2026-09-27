import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAdmin, requireAuth, signToken, type Role } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { createInvite, createResetLink } from "../lib/links-onetime.js";
import { deleteFamilyFiles, deleteStored } from "../lib/storage.js";
import { likeEscape } from "../lib/validate.js";

const UUID = z.string().uuid();
const id = (params: unknown) => (params as { id: string }).id;

async function adminCount(): Promise<number> {
  return (await query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE is_admin AND disabled_at IS NULL")).rows[0].n;
}

/** Server administration: families, users, invites, stepping into a family, audit log. */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireAdmin);

  app.get("/api/admin/overview", async () => {
    const families = (await query<{
      id: string; name: string; created_at: Date; disabled_at: Date | null; member_count: number; owners: string[] | null;
    }>(
      `SELECT f.id, f.name, f.created_at, f.disabled_at,
              count(u.id)::int AS member_count,
              array_agg(u.display_name ORDER BY u.display_name) FILTER (WHERE u.role = 'owner') AS owners
         FROM families f LEFT JOIN users u ON u.family_id = f.id
        GROUP BY f.id ORDER BY f.created_at ASC`)).rows;
    const counts = (await query<{ users: number; admins: number; invites: number }>(
      `SELECT (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM users WHERE is_admin) AS admins,
              (SELECT count(*)::int FROM invites WHERE kind = 'family' AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS invites`)).rows[0];
    return {
      families: families.map((f) => ({
        id: f.id, name: f.name, createdAt: f.created_at, disabled: f.disabled_at !== null,
        memberCount: f.member_count, owners: f.owners ?? [],
      })),
      userCount: counts.users,
      adminCount: counts.admins,
      pendingFamilyInvites: counts.invites,
    };
  });

  // ---- New-family invites ----
  app.get("/api/admin/family-invites", async () => {
    const { rows } = await query<{ id: string; note: string; created_at: Date; expires_at: Date }>(
      `SELECT id, note, created_at, expires_at FROM invites
        WHERE kind = 'family' AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`);
    return rows.map((r) => ({ id: r.id, note: r.note, createdAt: r.created_at, expiresAt: r.expires_at }));
  });

  app.post("/api/admin/family-invites", async (req, reply) => {
    const parsed = z.object({
      note: z.string().trim().max(200).optional(),
      expiresInDays: z.number().int().min(1).max(30).default(7),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const link = await createInvite({ kind: "family", note: parsed.data.note, createdBy: req.user.id, days: parsed.data.expiresInDays });
    await audit({ actorId: req.user.id, action: "invite.family_created_link", details: { inviteId: link.id, note: parsed.data.note ?? "" } });
    return reply.code(201).send(link);
  });

  app.delete("/api/admin/family-invites/:id", async (req, reply) => {
    if (!UUID.safeParse(id(req.params)).success) return reply.code(404).send({ error: "Invite not found" });
    const { rowCount } = await query(
      "UPDATE invites SET revoked_at = now() WHERE id = $1 AND kind = 'family' AND used_at IS NULL AND revoked_at IS NULL",
      [id(req.params)]);
    if (!rowCount) return reply.code(404).send({ error: "Invite not found" });
    await audit({ actorId: req.user.id, action: "invite.revoked", details: { inviteId: id(req.params) } });
    return reply.code(204).send();
  });

  // ---- Families ----
  app.patch("/api/admin/families/:id", async (req, reply) => {
    if (!UUID.safeParse(id(req.params)).success) return reply.code(404).send({ error: "Family not found" });
    const parsed = z.object({ name: z.string().trim().min(1).max(120).optional(), disabled: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { rows } = await query<{ name: string }>(
      `UPDATE families SET name = COALESCE($2, name),
              disabled_at = CASE WHEN $3::boolean IS NULL THEN disabled_at WHEN $3 THEN COALESCE(disabled_at, now()) ELSE NULL END
        WHERE id = $1 RETURNING name`,
      [id(req.params), parsed.data.name ?? null, parsed.data.disabled ?? null]);
    if (!rows[0]) return reply.code(404).send({ error: "Family not found" });
    await audit({ actorId: req.user.id, action: "family.updated", familyId: id(req.params), target: rows[0].name, details: parsed.data });
    return { ok: true };
  });

  app.delete("/api/admin/families/:id", async (req, reply) => {
    const familyId = id(req.params);
    if (!UUID.safeParse(familyId).success) return reply.code(404).send({ error: "Family not found" });
    const parsed = z.object({ confirmName: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Type the family's name to confirm" });
    const fam = (await query<{ name: string }>("SELECT name FROM families WHERE id = $1", [familyId])).rows[0];
    if (!fam) return reply.code(404).send({ error: "Family not found" });
    if (parsed.data.confirmName.trim() !== fam.name) return reply.code(400).send({ error: "The name doesn't match" });
    const own = (await query<{ family_id: string }>("SELECT family_id FROM users WHERE id = $1", [req.user.id])).rows[0];
    if (own?.family_id === familyId) return reply.code(400).send({ error: "You can't delete your own family" });
    const otherAdmins = (await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM users WHERE is_admin AND family_id <> $1", [familyId])).rows[0].n;
    if (otherAdmins === 0) return reply.code(400).send({ error: "That family has the only server admin" });

    // Collect its files first; rows cascade away with the family.
    const files = (await query<{ p: string | null }>(
      `SELECT rel_path AS p FROM media WHERE family_id = $1
        UNION ALL SELECT thumb_rel_path FROM media WHERE family_id = $1
        UNION ALL SELECT rel_path FROM documents WHERE family_id = $1`, [familyId])).rows.map((r) => r.p);
    await tx(async (client) => {
      await client.query("DELETE FROM families WHERE id = $1", [familyId]);
      await audit({ actorId: req.user.id, action: "family.deleted", target: fam.name, details: { familyId, files: files.length } }, client);
    });
    for (const p of files) await deleteStored(p);
    await deleteFamilyFiles(familyId);
    return reply.code(204).send();
  });

  // ---- Users ----
  app.get("/api/admin/users", async (req) => {
    const q = String((req.query as { q?: string }).q ?? "").trim();
    const { rows } = await query<{
      id: string; display_name: string; email: string; family_id: string; family_name: string; role: Role;
      is_admin: boolean; disabled_at: Date | null; last_login_at: Date | null; created_at: Date;
    }>(
      `SELECT u.id, u.display_name, u.email, u.family_id, f.name AS family_name, u.role, u.is_admin,
              u.disabled_at, u.last_login_at, u.created_at
         FROM users u JOIN families f ON f.id = u.family_id
        WHERE $1 = '' OR u.display_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%' OR f.name ILIKE '%' || $1 || '%'
        ORDER BY f.name ASC, u.display_name ASC`,
      [likeEscape(q)]);
    return rows.map((u) => ({
      id: u.id, displayName: u.display_name, email: u.email, familyId: u.family_id, familyName: u.family_name,
      role: u.role, isAdmin: u.is_admin, disabled: u.disabled_at !== null, lastLoginAt: u.last_login_at, createdAt: u.created_at,
      isYou: u.id === req.user.id,
    }));
  });

  app.patch("/api/admin/users/:id", async (req, reply) => {
    const userId = id(req.params);
    if (!UUID.safeParse(userId).success) return reply.code(404).send({ error: "User not found" });
    const parsed = z.object({
      isAdmin: z.boolean().optional(),
      disabled: z.boolean().optional(),
      role: z.enum(["owner", "member"]).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const u = (await query<{ is_admin: boolean; disabled: boolean; email: string; family_id: string; role: Role }>(
      "SELECT is_admin, disabled_at IS NOT NULL AS disabled, email, family_id, role FROM users WHERE id = $1", [userId])).rows[0];
    if (!u) return reply.code(404).send({ error: "User not found" });
    const losingAdmin = u.is_admin && !u.disabled && (parsed.data.isAdmin === false || parsed.data.disabled === true);
    if (losingAdmin && (await adminCount()) <= 1) return reply.code(400).send({ error: "The server needs at least one admin" });
    if (u.role === "owner" && parsed.data.role === "member") {
      const owners = (await query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE family_id = $1 AND role = 'owner'", [u.family_id])).rows[0].n;
      if (owners <= 1) return reply.code(400).send({ error: "A family needs at least one owner" });
    }
    await query(
      `UPDATE users SET
         is_admin = COALESCE($2, is_admin),
         disabled_at = CASE WHEN $3::boolean IS NULL THEN disabled_at WHEN $3 THEN COALESCE(disabled_at, now()) ELSE NULL END,
         role = COALESCE($4, role),
         token_version = token_version + 1
       WHERE id = $1`,
      [userId, parsed.data.isAdmin ?? null, parsed.data.disabled ?? null, parsed.data.role ?? null]);
    await audit({ actorId: req.user.id, action: "user.updated", familyId: u.family_id, target: u.email, details: parsed.data });
    return { ok: true };
  });

  app.post("/api/admin/users/:id/reset-link", async (req, reply) => {
    const userId = id(req.params);
    if (!UUID.safeParse(userId).success) return reply.code(404).send({ error: "User not found" });
    const u = (await query<{ email: string; family_id: string }>("SELECT email, family_id FROM users WHERE id = $1", [userId])).rows[0];
    if (!u) return reply.code(404).send({ error: "User not found" });
    const link = await createResetLink(userId, req.user.id);
    await audit({ actorId: req.user.id, action: "password.reset_link_created", familyId: u.family_id, target: u.email });
    return reply.code(201).send(link);
  });

  // ---- Stepping into a family ----
  app.post("/api/admin/view-family", async (req, reply) => {
    const parsed = z.object({ familyId: UUID }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const me = (await query<{ id: string; family_id: string; role: Role; token_version: number }>(
      "SELECT id, family_id, role, token_version FROM users WHERE id = $1", [req.user.id])).rows[0];
    const fam = (await query<{ name: string }>("SELECT name FROM families WHERE id = $1", [parsed.data.familyId])).rows[0];
    if (!fam) return reply.code(404).send({ error: "Family not found" });
    if (parsed.data.familyId === me.family_id) return { token: signToken(reply, me) };
    await audit({ actorId: me.id, action: "admin.view_family", familyId: parsed.data.familyId, target: fam.name });
    return { token: signToken(reply, me, { homeFamilyId: me.family_id, familyId: parsed.data.familyId }) };
  });

  app.post("/api/admin/return", async (req) => {
    const me = (await query<{ id: string; family_id: string; role: Role; token_version: number }>(
      "SELECT id, family_id, role, token_version FROM users WHERE id = $1", [req.user.id])).rows[0];
    if (req.user.adminView) await audit({ actorId: me.id, action: "admin.return", familyId: req.user.familyId });
    return { token: signToken(req.server, me) };
  });

  // ---- Audit log ----
  app.get("/api/admin/audit", async (req) => {
    const qs = req.query as { limit?: string; before?: string };
    const limit = Math.min(Math.max(Number(qs.limit) || 100, 1), 500);
    const before = /^\d+$/.test(qs.before ?? "") ? qs.before : null;
    const { rows } = await query<{
      id: string; at: Date; actor_name: string; action: string; family_id: string | null; family_name: string | null; target: string; details: unknown;
    }>(
      `SELECT a.id, a.at, a.actor_name, a.action, a.family_id, f.name AS family_name, a.target, a.details
         FROM audit_log a LEFT JOIN families f ON f.id = a.family_id
        WHERE $1::bigint IS NULL OR a.id < $1::bigint
        ORDER BY a.id DESC LIMIT $2`,
      [before, limit]);
    return rows.map((r) => ({
      id: r.id, at: r.at, actorName: r.actor_name, action: r.action, familyId: r.family_id,
      familyName: r.family_name, target: r.target, details: r.details,
    }));
  });
}
