import { customAlphabet } from "nanoid";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { signFileUrl } from "../lib/filesign.js";

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

  // --- Public, read-only (no auth) ---

  app.get("/api/share/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const link = await query<{ target_type: string; target_id: string; family_id: string }>(
      "SELECT target_type, target_id, family_id FROM share_links WHERE token = $1", [token]);
    if (!link.rows[0]) return reply.code(404).send({ error: "Link not found or revoked" });
    const { target_type: targetType, target_id: tripId, family_id: familyId } = link.rows[0];

    const photosOf = async (whereTripPhotos = true) => {
      const { rows } = await query<any>(
        `SELECT id, rel_path, thumb_rel_path, kind, caption FROM media
         WHERE family_id = $1 AND trip_id = $2 ORDER BY taken_at NULLS LAST, created_at ASC`,
        [familyId, tripId]);
      return rows.map((m, i) => ({
        id: m.id, url: signFileUrl(m.rel_path), thumbUrl: m.thumb_rel_path ? signFileUrl(m.thumb_rel_path) : null,
        mediaType: m.kind, caption: m.caption, seq: i,
      }));
    };

    const tripRow = await query<any>(
      "SELECT id, name, description, color, start_date, end_date FROM trips WHERE id = $1 AND family_id = $2",
      [tripId, familyId]);
    if (!tripRow.rows[0]) return reply.code(404).send({ error: "Link not found or revoked" });
    const t = tripRow.rows[0];
    const trip = { id: t.id, name: t.name, description: t.description, color: t.color, startDate: t.start_date, endDate: t.end_date };

    if (targetType === "album") {
      return { targetType, trip, photos: await photosOf() };
    }

    // trip share: visits (with geometry + their linked photos) + itinerary
    const visits = (await query<any>(
      `SELECT v.id, v.kind, v.title, v.notes, v.color, v.icon, v.occurred_on,
              ST_AsGeoJSON(v.geom) AS geom,
              COALESCE((SELECT json_agg(json_build_object('id', m.id, 'rel_path', m.rel_path,
                         'thumb_rel_path', m.thumb_rel_path, 'mediaType', m.kind, 'caption', m.caption) ORDER BY m.created_at)
                       FROM links l JOIN media m ON m.id = CASE WHEN l.from_type='media' THEN l.from_id ELSE l.to_id END
                       WHERE l.family_id = v.family_id
                         AND ((l.from_type='media' AND l.to_type='visit' AND l.to_id=v.id)
                           OR (l.to_type='media' AND l.from_type='visit' AND l.from_id=v.id))), '[]') AS photos
       FROM visits v WHERE v.trip_id = $1 AND v.family_id = $2
       ORDER BY v.occurred_on NULLS LAST, v.created_at ASC`,
      [tripId, familyId])).rows.map((r) => ({
        id: r.id, kind: r.kind, title: r.title, notes: r.notes, color: r.color, icon: r.icon, occurredOn: r.occurred_on,
        geometry: r.geom ? JSON.parse(r.geom) : null,
        photos: (r.photos as any[]).map((p, i) => ({
          id: p.id, url: signFileUrl(p.rel_path), thumbUrl: p.thumb_rel_path ? signFileUrl(p.thumb_rel_path) : null,
          mediaType: p.mediaType, caption: p.caption, seq: i,
        })),
      }));

    const itinerary = (await query<any>(
      "SELECT id, title, notes, scheduled_on, seq FROM itinerary_items WHERE trip_id = $1 AND family_id = $2 ORDER BY seq ASC",
      [tripId, familyId])).rows.map((r) => ({ id: r.id, title: r.title, notes: r.notes, scheduledOn: r.scheduled_on, seq: r.seq }));

    return { targetType, trip, visits, itinerary, photos: await photosOf() };
  });
}
