import { customAlphabet } from "nanoid";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { signFileUrl } from "../lib/filesign.js";

const makeToken = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 20);

async function ownsMapSet(familyId: string, mapSetId: string): Promise<boolean> {
  const { rowCount } = await query("SELECT 1 FROM map_sets WHERE id = $1 AND family_id = $2", [
    mapSetId,
    familyId,
  ]);
  return Boolean(rowCount);
}

// Public, read-only view of a map set's pins: visits that are members of the map,
// with their waypoints and linked photos (served via signed URLs, so they load
// without a session — which is exactly what a public share needs).
async function loadPublicItems(mapSetId: string) {
  const { rows } = await query<any>(
    `SELECT v.id, v.kind, v.title, v.notes, v.color, v.icon, v.occurred_on, v.trip_id,
            ST_AsGeoJSON(v.geom) AS geom,
            COALESCE((SELECT json_agg(json_build_object('label', w.label, 'kind', w.kind, 'seq', w.seq,
                       'lng', ST_X(w.geom), 'lat', ST_Y(w.geom)) ORDER BY w.seq)
                     FROM visit_waypoints w WHERE w.visit_id = v.id), '[]') AS waypoints,
            COALESCE((SELECT json_agg(json_build_object('id', m.id, 'rel_path', m.rel_path,
                       'thumb_rel_path', m.thumb_rel_path, 'mediaType', m.kind, 'caption', m.caption)
                       ORDER BY m.created_at)
                     FROM links l JOIN media m ON m.id = CASE
                        WHEN l.from_type = 'media' THEN l.from_id ELSE l.to_id END
                     WHERE l.family_id = v.family_id
                       AND ((l.from_type='media' AND l.to_type='visit' AND l.to_id=v.id)
                         OR (l.to_type='media' AND l.from_type='visit' AND l.from_id=v.id))), '[]') AS photos
     FROM visits v
     JOIN map_set_visits msv ON msv.visit_id = v.id
     WHERE msv.map_set_id = $1
     ORDER BY v.occurred_on NULLS LAST, v.created_at ASC`,
    [mapSetId],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    notes: r.notes,
    color: r.color,
    icon: r.icon,
    occurredOn: r.occurred_on,
    tripId: r.trip_id,
    geometry: r.geom ? JSON.parse(r.geom) : null,
    waypoints: r.waypoints,
    photos: (r.photos as any[]).map((p, i) => ({
      id: p.id,
      url: signFileUrl(p.rel_path),
      thumbUrl: p.thumb_rel_path ? signFileUrl(p.thumb_rel_path) : null,
      mediaType: p.mediaType,
      caption: p.caption,
      seq: i,
    })),
  }));
}

export async function shareRoutes(app: FastifyInstance): Promise<void> {
  // --- Authenticated management ---

  app.get("/api/map-sets/:mapSetId/shares", { preHandler: requireAuth }, async (req, reply) => {
    const mapSetId = (req.params as { mapSetId: string }).mapSetId;
    if (!(await ownsMapSet(req.user.familyId, mapSetId))) {
      return reply.code(404).send({ error: "Map set not found" });
    }
    const { rows } = await query<any>(
      "SELECT id, token, created_at FROM share_links WHERE map_set_id = $1 ORDER BY created_at DESC",
      [mapSetId],
    );
    return rows.map((r) => ({ id: r.id, token: r.token, createdAt: r.created_at }));
  });

  app.post("/api/map-sets/:mapSetId/shares", { preHandler: requireAuth }, async (req, reply) => {
    const mapSetId = (req.params as { mapSetId: string }).mapSetId;
    if (!(await ownsMapSet(req.user.familyId, mapSetId))) {
      return reply.code(404).send({ error: "Map set not found" });
    }
    const { rows } = await query<any>(
      `INSERT INTO share_links (token, map_set_id, family_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id, token, created_at`,
      [makeToken(), mapSetId, req.user.familyId, req.user.id],
    );
    const r = rows[0];
    return reply.code(201).send({ id: r.id, token: r.token, createdAt: r.created_at });
  });

  app.delete("/api/shares/:id", { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM share_links WHERE id = $1 AND family_id = $2", [
      id,
      req.user.familyId,
    ]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });

  // --- Public, read-only (no auth) ---

  app.get("/api/share/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const link = await query<{ map_set_id: string }>(
      "SELECT map_set_id FROM share_links WHERE token = $1",
      [token],
    );
    if (!link.rows[0]) return reply.code(404).send({ error: "Link not found or revoked" });
    const mapSetId = link.rows[0].map_set_id;

    const ms = await query<any>(
      `SELECT name, description, base_kind, style_url, overlay_url, overlay_bounds,
              default_lng, default_lat, default_zoom
       FROM map_sets WHERE id = $1`,
      [mapSetId],
    );
    if (!ms.rows[0]) return reply.code(404).send({ error: "Map set not found" });
    const m = ms.rows[0];

    // Trips become family-scoped — show the ones referenced by this map's visits.
    const trips = await query<any>(
      `SELECT DISTINCT t.id, t.name, t.color, t.start_date, t.end_date
       FROM trips t
       JOIN visits v ON v.trip_id = t.id
       JOIN map_set_visits msv ON msv.visit_id = v.id
       WHERE msv.map_set_id = $1`,
      [mapSetId],
    );

    return {
      mapSet: {
        name: m.name,
        description: m.description,
        baseKind: m.base_kind,
        styleUrl: m.style_url,
        overlayUrl: m.overlay_url,
        overlayBounds: m.overlay_bounds,
        defaultLng: m.default_lng,
        defaultLat: m.default_lat,
        defaultZoom: m.default_zoom,
      },
      trips: trips.rows.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        startDate: t.start_date,
        endDate: t.end_date,
      })),
      items: await loadPublicItems(mapSetId),
    };
  });
}
