import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { mediaUrls } from "../lib/media/urls.js";
import { assertRefs, editableWhere, loadEditable, loadReadable, readableWhere, scopeOf } from "../lib/access.js";
import { recordActivity } from "../lib/activity.js";
import { badRequest, notFound } from "../lib/errors.js";
import { endsBeforeStart, optionalYmd } from "../lib/validate.js";
import { lat, lng, visitGeometry } from "../lib/geojson.js";

const geometrySchema = visitGeometry.nullable();
const waypointSchema = z.object({
  label: z.string().min(1).max(200),
  kind: z.enum(["origin", "stop", "destination", "port"]).default("stop"),
  lng, lat, seq: z.number().int().min(0).max(100000).optional(),
  arriveAt: z.string().datetime().nullish(), departAt: z.string().datetime().nullish(),
});
const visitSchema = z.object({
  kind: z.enum(["place", "food", "flight", "cruise", "drive", "stay", "custom"]),
  title: z.string().min(1).max(200),
  notes: z.string().max(20000).optional(),
  themeId: z.string().uuid().nullish(),
  tripId: z.string().uuid().nullish(),
  color: z.string().max(40).nullish(),
  icon: z.string().max(200).nullish(),
  occurredOn: optionalYmd,
  occurredEnd: optionalYmd,
  properties: z.record(z.unknown()).optional(),
  geometry: geometrySchema.optional(),
  waypoints: z.array(waypointSchema).max(500).optional(),
});
// Create only: the editor's key for this new place, so a retry returns it rather than making another.
const createSchema = visitSchema.extend({ clientKey: z.string().uuid().optional() });

const DATE_ORDER = "The end date can't be before the start date";

/**
 * Places with everything the map needs, in four queries however many there
 * are: the places ($1 = my family), their waypoints, their photos and the
 * people tagged on them — only what my family may see.
 */
export async function loadVisits(familyId: string, filter: { ids?: string[] } = {}) {
  const { rows } = await query<any>(
    `SELECT v.id, v.trip_id, v.kind, v.title, v.notes, v.theme_id, v.color, v.icon,
            v.occurred_on, v.occurred_end, v.properties, v.created_by, v.created_at,
            u.display_name AS created_by_name, ST_AsGeoJSON(v.geom) AS geom,
            v.family_id, f.name AS family_name, ${editableWhere("visit", "v", "$1")} AS can_edit
     FROM visits v LEFT JOIN users u ON u.id = v.created_by JOIN families f ON f.id = v.family_id
     WHERE ${readableWhere("visit", "v", "$1")} ${filter.ids ? "AND v.id = ANY($2::uuid[])" : ""}
     ORDER BY v.occurred_on NULLS LAST, v.created_at ASC`,
    filter.ids ? [familyId, filter.ids] : [familyId],
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const group = <T,>(list: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of list) {
      const k = key(x);
      const bucket = m.get(k);
      if (bucket) bucket.push(x); else m.set(k, [x]);
    }
    return m;
  };
  const wps = group((await query<any>(
    `SELECT visit_id, id, label, kind, seq, arrive_at, depart_at, ST_X(geom) AS lng, ST_Y(geom) AS lat
     FROM visit_waypoints WHERE visit_id = ANY($1::uuid[]) ORDER BY seq ASC`, [ids])).rows, (w) => w.visit_id);
  const photos = group((await query<any>(
    `SELECT CASE WHEN l.from_type = 'visit' THEN l.from_id ELSE l.to_id END AS visit_id,
            m.id, m.kind, m.caption, m.created_at
     FROM links l JOIN media m ON m.id = CASE WHEN l.from_type = 'media' THEN l.from_id ELSE l.to_id END
     WHERE ((l.from_type = 'media' AND l.to_type = 'visit' AND l.to_id = ANY($2::uuid[]))
         OR (l.to_type = 'media' AND l.from_type = 'visit' AND l.from_id = ANY($2::uuid[])))
       AND ${readableWhere("media", "m", "$1")}
     ORDER BY m.created_at ASC`, [familyId, ids])).rows, (p) => p.visit_id);
  const people = group((await query<any>(
    `SELECT DISTINCT CASE WHEN l.from_type = 'visit' THEN l.from_id ELSE l.to_id END AS visit_id, p.id
     FROM links l JOIN people p ON p.id = CASE WHEN l.from_type = 'person' THEN l.from_id ELSE l.to_id END
     WHERE ((l.from_type = 'person' AND l.to_type = 'visit' AND l.to_id = ANY($2::uuid[]))
         OR (l.to_type = 'person' AND l.from_type = 'visit' AND l.from_id = ANY($2::uuid[])))
       AND ${readableWhere("person", "p", "$1")}`, [familyId, ids])).rows, (p) => p.visit_id);

  return rows.map((r) => ({
    id: r.id, tripId: r.trip_id, kind: r.kind, title: r.title, notes: r.notes,
    themeId: r.theme_id, color: r.color, icon: r.icon,
    occurredOn: r.occurred_on, occurredEnd: r.occurred_end, properties: r.properties,
    createdBy: r.created_by, createdByName: r.created_by_name, createdAt: r.created_at,
    // Who added it (another family's, on a shared trip, when familyId isn't mine), and whether I may change it.
    familyId: r.family_id, familyName: r.family_name, canEdit: r.can_edit,
    geometry: r.geom ? JSON.parse(r.geom) : null,
    waypoints: (wps.get(r.id) ?? []).map((w) => ({
      id: w.id, label: w.label, kind: w.kind, seq: w.seq, lng: w.lng, lat: w.lat,
      arriveAt: w.arrive_at, departAt: w.depart_at,
    })),
    photos: (photos.get(r.id) ?? []).map((p, i) => ({
      id: p.id,
      ...mediaUrls(p),
      mediaType: p.kind,
      caption: p.caption,
      seq: i,
    })),
    personIds: (people.get(r.id) ?? []).map((p) => p.id),
  }));
}

export async function loadVisit(familyId: string, id: string) {
  return (await loadVisits(familyId, { ids: [id] }))[0] ?? null;
}

async function insertWaypoints(client: PoolClient, visitId: string, waypoints: z.infer<typeof waypointSchema>[]): Promise<void> {
  for (let i = 0; i < waypoints.length; i++) {
    const w = waypoints[i];
    await client.query(
      `INSERT INTO visit_waypoints (visit_id, label, kind, seq, geom, arrive_at, depart_at)
       VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($5,$6),4326), $7,$8)`,
      [visitId, w.label, w.kind, w.seq ?? i, w.lng, w.lat, w.arriveAt ?? null, w.departAt ?? null],
    );
  }
}

export async function visitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Everything on my family's map: its own places and those on trips shared with it.
  app.get("/api/visits", async (req) => loadVisits(req.user.familyId));

  app.post("/api/visits", async (req, reply) => {
    const b = createSchema.parse(req.body);
    const scope = scopeOf(req);
    if (endsBeforeStart(b.occurredOn, b.occurredEnd)) throw badRequest(DATE_ORDER);
    await assertRefs(scope, { trip: b.tripId, theme: b.themeId });
    const created = await tx(async (client) => {
      const geomJson = b.geometry ? JSON.stringify(b.geometry) : null;
      const res = await client.query<{ id: string }>(
        `INSERT INTO visits (family_id, trip_id, kind, title, notes, theme_id, color, icon, occurred_on, occurred_end, geom, created_by, properties, client_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           CASE WHEN $11::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($11),4326) END,
           $12, COALESCE($13::jsonb,'{}'::jsonb), $14)
         ON CONFLICT (family_id, client_key) WHERE client_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [req.user.familyId, b.tripId ?? null, b.kind, b.title, b.notes ?? "", b.themeId ?? null,
         b.color ?? null, b.icon ?? null, b.occurredOn ?? null, b.occurredEnd ?? null, geomJson,
         req.user.id, b.properties ? JSON.stringify(b.properties) : null, b.clientKey ?? null],
      );
      if (!res.rows[0]) return null; // this key's place already exists
      const vid = res.rows[0].id;
      if (b.waypoints?.length) await insertWaypoints(client, vid, b.waypoints);
      await recordActivity({ tripId: b.tripId, familyId: scope.familyId, userId: scope.userId, kind: "visit.added", targetType: "visit", targetId: vid, summary: b.title }, client);
      return vid;
    });
    if (created) return reply.code(201).send(await loadVisit(req.user.familyId, created));
    const existing = await query<{ id: string }>(
      "SELECT id FROM visits WHERE family_id = $1 AND client_key = $2", [req.user.familyId, b.clientKey],
    );
    return reply.code(200).send(await loadVisit(req.user.familyId, existing.rows[0].id));
  });

  app.get("/api/visits/:id", async (req) => {
    const v = await loadVisit(req.user.familyId, (req.params as { id: string }).id);
    if (!v) throw notFound("Place not found");
    return v;
  });

  app.patch("/api/visits/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    const current = await loadEditable<{ occurred_on: string | null; occurred_end: string | null }>("visit", id, scope);
    const b = visitSchema.partial().parse(req.body);
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    const start = has("occurredOn") ? b.occurredOn : current.occurred_on;
    const end = has("occurredEnd") ? b.occurredEnd : current.occurred_end;
    if (endsBeforeStart(start, end)) throw badRequest(DATE_ORDER);
    await assertRefs(scope, { trip: b.tripId, theme: b.themeId });
    await tx(async (client) => {
      const geomProvided = Object.prototype.hasOwnProperty.call(b, "geometry");
      const geomJson = b.geometry ? JSON.stringify(b.geometry) : null;
      await client.query(
        `UPDATE visits SET
           kind = COALESCE($2, kind), title = COALESCE($3, title), notes = COALESCE($4, notes),
           theme_id = CASE WHEN $5::boolean THEN $6 ELSE theme_id END,
           color = CASE WHEN $7::boolean THEN $8 ELSE color END,
           icon = CASE WHEN $9::boolean THEN $10 ELSE icon END,
           occurred_on = CASE WHEN $11::boolean THEN $12 ELSE occurred_on END,
           occurred_end = CASE WHEN $13::boolean THEN $14 ELSE occurred_end END,
           trip_id = CASE WHEN $15::boolean THEN $16 ELSE trip_id END,
           geom = CASE WHEN $17::boolean THEN
             (CASE WHEN $18::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($18),4326) END)
             ELSE geom END,
           properties = CASE WHEN $19::boolean THEN COALESCE($20::jsonb,'{}'::jsonb) ELSE properties END,
           updated_at = now()
         WHERE id = $1 AND ${editableWhere("visit", "visits", "$21")}`,
        [id, b.kind ?? null, b.title ?? null, b.notes ?? null,
         has("themeId"), b.themeId ?? null, has("color"), b.color ?? null,
         has("icon"), b.icon ?? null, has("occurredOn"), b.occurredOn ?? null,
         has("occurredEnd"), b.occurredEnd ?? null, has("tripId"), b.tripId ?? null,
         geomProvided, geomJson, has("properties"), b.properties ? JSON.stringify(b.properties) : null,
         scope.familyId],
      );
      if (b.waypoints) {
        await client.query("DELETE FROM visit_waypoints WHERE visit_id = $1", [id]);
        await insertWaypoints(client, id, b.waypoints);
      }
    });
    return loadVisit(req.user.familyId, id);
  });

  app.delete("/api/visits/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await loadEditable("visit", id, scopeOf(req));
    await query(`DELETE FROM visits WHERE id = $1 AND ${editableWhere("visit", "visits", "$2")}`, [id, req.user.familyId]);
    return reply.code(204).send();
  });

  // --- Comments (now on visits) ---
  app.get("/api/visits/:id/comments", async (req) => {
    const id = (req.params as { id: string }).id;
    await loadReadable("visit", id, scopeOf(req));
    const { rows } = await query<any>(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.display_name AS author, f.name AS family_name
       FROM comments c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN families f ON f.id = u.family_id
       WHERE c.visit_id = $1 ORDER BY c.created_at ASC`, [id],
    );
    return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at, userId: r.user_id, author: r.author, familyName: r.family_name }));
  });

  app.post("/api/visits/:id/comments", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    const visit = await loadReadable<{ trip_id: string | null; title: string }>("visit", id, scope);
    const { body } = z.object({ body: z.string().min(1).max(4000) }).parse(req.body);
    const { rows } = await query<any>(
      `INSERT INTO comments (visit_id, user_id, body) VALUES ($1,$2,$3)
       RETURNING id, body, created_at, user_id`, [id, req.user.id, body],
    );
    const r = rows[0];
    await recordActivity({ tripId: visit.trip_id, familyId: scope.familyId, userId: scope.userId, kind: "comment.added", targetType: "visit", targetId: id, summary: visit.title });
    return reply.code(201).send({ id: r.id, body: r.body, createdAt: r.created_at, userId: r.user_id });
  });

  app.delete("/api/comments/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query(
      `DELETE FROM comments c USING visits v
       WHERE c.id = $1 AND c.visit_id = v.id AND c.user_id = $3 AND ${readableWhere("visit", "v", "$2")}`,
      [id, req.user.familyId, req.user.id],
    );
    if (!res.rowCount) throw notFound("Comment not found");
    return reply.code(204).send();
  });
}
