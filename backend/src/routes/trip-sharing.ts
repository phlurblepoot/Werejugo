import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAuth, requireOwner } from "../lib/auth.js";
import { loadEditable, loadReadable, scopeOf, tripRole } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { recordActivity } from "../lib/activity.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { expiresInDays, hashToken, newToken } from "../lib/tokens.js";

const role = z.enum(["coowner", "contributor"]);
const GONE = "This trip invite has expired, was already used, or was cancelled. Ask for a new one.";

interface InviteRow {
  id: string; trip_id: string; role: "coowner" | "contributor"; expires_at: Date;
  trip_name: string; start_date: string | null; end_date: string | null;
  host_family_id: string; host_family_name: string; created_by_name: string | null;
}

async function usableInvite(token: string, lock?: Pick<import("pg").PoolClient, "query">): Promise<InviteRow | null> {
  const sql = `SELECT i.id, i.trip_id, i.role, i.expires_at, t.name AS trip_name,
                      to_char(t.start_date, 'YYYY-MM-DD') AS start_date, to_char(t.end_date, 'YYYY-MM-DD') AS end_date,
                      t.family_id AS host_family_id, f.name AS host_family_name, u.display_name AS created_by_name
                 FROM trip_invites i JOIN trips t ON t.id = i.trip_id JOIN families f ON f.id = t.family_id
                 LEFT JOIN users u ON u.id = i.created_by
                WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
                ${lock ? "FOR UPDATE OF i" : ""}`;
  const { rows } = await (lock ?? { query }).query<InviteRow>(sql, [hashToken(token)]);
  return rows[0] ?? null;
}

/** Sharing a trip with other families: members, invites, joining and leaving, and its activity. */
export async function tripSharingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/trips/:id/members", async (req) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    const trip = await loadReadable<{ family_id: string }>("trip", id, scope);
    const myRole = await tripRole(id, scope);
    const host = (await query<{ id: string; name: string }>("SELECT id, name FROM families WHERE id = $1", [trip.family_id])).rows[0];
    const members = (await query<{ family_id: string; name: string; role: string; joined_at: Date }>(
      `SELECT m.family_id, f.name, m.role, m.joined_at FROM trip_members m JOIN families f ON f.id = m.family_id
        WHERE m.trip_id = $1 ORDER BY m.joined_at ASC`, [id])).rows;
    const invites = myRole === "host"
      ? (await query<{ id: string; role: string; note: string; created_at: Date; expires_at: Date }>(
          `SELECT id, role, note, created_at, expires_at FROM trip_invites
            WHERE trip_id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [id])).rows
      : [];
    return {
      myRole,
      host: { familyId: host.id, familyName: host.name },
      members: members.map((m) => ({ familyId: m.family_id, familyName: m.name, role: m.role, joinedAt: m.joined_at, isYou: m.family_id === scope.familyId })),
      invites: invites.map((i) => ({ id: i.id, role: i.role, note: i.note, createdAt: i.created_at, expiresAt: i.expires_at })),
    };
  });

  // Only the host family's owners bring other families onto a trip.
  app.post("/api/trips/:id/invites", { preHandler: requireOwner }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    await loadEditable("trip", id, scope);
    const b = z.object({ role, note: z.string().max(200).optional(), expiresInDays: z.number().int().min(1).max(30).optional() }).parse(req.body ?? {});
    const token = newToken();
    const { rows } = await query<{ id: string; expires_at: Date }>(
      `INSERT INTO trip_invites (trip_id, role, token_hash, note, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, expires_at`,
      [id, b.role, hashToken(token), b.note ?? "", scope.userId, expiresInDays(b.expiresInDays ?? 7)]);
    await audit({ actorId: scope.userId, action: "trip.invite_created", familyId: scope.familyId, details: { tripId: id, role: b.role } });
    return reply.code(201).send({ id: rows[0].id, token, path: `/trip-invite/${token}`, expiresAt: rows[0].expires_at.toISOString() });
  });

  app.delete("/api/trips/:id/invites/:inviteId", { preHandler: requireOwner }, async (req, reply) => {
    const { id, inviteId } = req.params as { id: string; inviteId: string };
    await loadEditable("trip", id, scopeOf(req));
    const { rowCount } = await query(
      "UPDATE trip_invites SET revoked_at = now() WHERE id = $1 AND trip_id = $2 AND used_at IS NULL AND revoked_at IS NULL", [inviteId, id]);
    if (!rowCount) throw notFound("Invite not found");
    return reply.code(204).send();
  });

  app.get("/api/trip-invites/:token", async (req) => {
    const inv = await usableInvite((req.params as { token: string }).token);
    if (!inv) throw notFound(GONE);
    const scope = scopeOf(req);
    const already = inv.host_family_id === scope.familyId || (await tripRole(inv.trip_id, scope)) !== null;
    return {
      tripId: inv.trip_id, tripName: inv.trip_name, startDate: inv.start_date, endDate: inv.end_date,
      hostFamilyName: inv.host_family_name, invitedBy: inv.created_by_name, role: inv.role,
      expiresAt: inv.expires_at.toISOString(), alreadyOnTrip: already, canAccept: !already && scope.role === "owner",
    };
  });

  app.post("/api/trip-invites/:token/accept", { preHandler: requireOwner }, async (req) => {
    const scope = scopeOf(req);
    const joined = await tx(async (client) => {
      const inv = await usableInvite((req.params as { token: string }).token, client);
      if (!inv) throw notFound(GONE);
      if (inv.host_family_id === scope.familyId || (await tripRole(inv.trip_id, scope, client))) {
        throw conflict("Your family is already on this trip");
      }
      await client.query(
        "INSERT INTO trip_members (trip_id, family_id, role, invited_by) VALUES ($1, $2, $3, (SELECT created_by FROM trip_invites WHERE id = $4))",
        [inv.trip_id, scope.familyId, inv.role, inv.id]);
      await client.query("UPDATE trip_invites SET used_at = now(), used_by_family = $2 WHERE id = $1", [inv.id, scope.familyId]);
      await recordActivity({ tripId: inv.trip_id, familyId: scope.familyId, userId: scope.userId, kind: "member.joined", summary: inv.role }, client);
      await audit({ actorId: scope.userId, action: "trip.member_joined", familyId: scope.familyId, target: inv.trip_name, details: { tripId: inv.trip_id, role: inv.role } }, client);
      return inv;
    });
    return { tripId: joined.trip_id, role: joined.role };
  });

  app.patch("/api/trips/:id/members/:familyId", { preHandler: requireOwner }, async (req) => {
    const { id, familyId } = req.params as { id: string; familyId: string };
    const scope = scopeOf(req);
    await loadEditable("trip", id, scope);
    const b = z.object({ role }).parse(req.body);
    const { rowCount } = await query("UPDATE trip_members SET role = $3 WHERE trip_id = $1 AND family_id = $2", [id, familyId, b.role]);
    if (!rowCount) throw notFound("That family isn't on this trip");
    await recordActivity({ tripId: id, familyId, userId: scope.userId, kind: "member.role_changed", summary: b.role });
    return { ok: true };
  });

  // The host removes a family, or a guest family's owner takes their family off the trip.
  app.delete("/api/trips/:id/members/:familyId", { preHandler: requireOwner }, async (req, reply) => {
    const { id, familyId } = req.params as { id: string; familyId: string };
    const scope = scopeOf(req);
    await loadReadable("trip", id, scope);
    const myRole = await tripRole(id, scope);
    const leaving = familyId === scope.familyId;
    if (myRole === "host" && leaving) throw badRequest("The host can't leave its own trip");
    if (!leaving && myRole !== "host") throw forbidden("Only the host can remove a family");
    const { rowCount } = await query("DELETE FROM trip_members WHERE trip_id = $1 AND family_id = $2", [id, familyId]);
    if (!rowCount) throw notFound("That family isn't on this trip");
    await recordActivity({ tripId: id, familyId, userId: scope.userId, kind: leaving ? "member.left" : "member.removed" });
    await audit({ actorId: scope.userId, action: leaving ? "trip.member_left" : "trip.member_removed", familyId: scope.familyId, details: { tripId: id, familyId } });
    return reply.code(204).send();
  });

  app.get("/api/trips/:id/activity", async (req) => {
    const id = (req.params as { id: string }).id;
    await loadReadable("trip", id, scopeOf(req));
    const { rows } = await query<{
      id: string; kind: string; target_type: string; target_id: string | null; summary: string; at: Date;
      family_id: string | null; family_name: string | null; user_name: string | null;
    }>(
      `SELECT a.id, a.kind, a.target_type, a.target_id, a.summary, a.at, a.family_id, f.name AS family_name, u.display_name AS user_name
         FROM activity a LEFT JOIN families f ON f.id = a.family_id LEFT JOIN users u ON u.id = a.user_id
        WHERE a.trip_id = $1 ORDER BY a.id DESC LIMIT 50`, [id]);
    return rows.map((r) => ({
      id: r.id, kind: r.kind, targetType: r.target_type, targetId: r.target_id, summary: r.summary, at: r.at,
      familyId: r.family_id, familyName: r.family_name, userName: r.user_name,
    }));
  });
}
