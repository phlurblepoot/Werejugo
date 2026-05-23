import { customAlphabet } from "nanoid";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

const makeToken = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 20);

async function ownsMapSet(familyId: string, mapSetId: string): Promise<boolean> {
  const { rowCount } = await query("SELECT 1 FROM map_sets WHERE id = $1 AND family_id = $2", [
    mapSetId,
    familyId,
  ]);
  return Boolean(rowCount);
}

async function loadPublicItems(mapSetId: string) {
  const { rows } = await query<any>(
    `SELECT i.id, i.kind, i.title, i.notes, i.color, i.icon, i.occurred_on, i.trip_id,
            ST_AsGeoJSON(i.geom) AS geom,
            COALESCE((SELECT json_agg(json_build_object('label', w.label, 'kind', w.kind, 'seq', w.seq,
                       'lng', ST_X(w.geom), 'lat', ST_Y(w.geom)) ORDER BY w.seq)
                     FROM item_waypoints w WHERE w.item_id = i.id), '[]') AS waypoints,
            COALESCE((SELECT json_agg(json_build_object('id', p.id, 'url', p.url, 'thumbUrl', p.thumb_url,
                       'mediaType', p.media_type, 'caption', p.caption, 'seq', p.seq) ORDER BY p.seq)
                     FROM item_photos p WHERE p.item_id = i.id), '[]') AS photos
     FROM items i WHERE i.map_set_id = $1
     ORDER BY i.occurred_on NULLS LAST, i.created_at ASC`,
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
    photos: r.photos,
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

    const trips = await query<any>(
      "SELECT id, name, color, start_date, end_date FROM trips WHERE map_set_id = $1",
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
