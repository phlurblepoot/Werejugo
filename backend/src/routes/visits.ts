import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

const geometrySchema = z.object({ type: z.enum(["Point", "LineString"]), coordinates: z.any() }).nullable();
const waypointSchema = z.object({
  label: z.string().min(1).max(200),
  kind: z.enum(["origin", "stop", "destination", "port"]).default("stop"),
  lng: z.number(), lat: z.number(), seq: z.number().int().optional(),
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
  occurredOn: z.string().nullish(),
  occurredEnd: z.string().nullish(),
  properties: z.record(z.unknown()).optional(),
  geometry: geometrySchema.optional(),
  waypoints: z.array(waypointSchema).optional(),
});

async function ownsVisit(familyId: string, id: string): Promise<boolean> {
  const { rowCount } = await query("SELECT 1 FROM visits WHERE id = $1 AND family_id = $2", [id, familyId]);
  return Boolean(rowCount);
}

async function loadVisit(familyId: string, id: string) {
  const { rows } = await query<any>(
    `SELECT v.id, v.trip_id, v.kind, v.title, v.notes, v.theme_id, v.color, v.icon,
            v.occurred_on, v.occurred_end, v.properties, v.created_by, v.created_at,
            u.display_name AS created_by_name, ST_AsGeoJSON(v.geom) AS geom
     FROM visits v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.id = $1 AND v.family_id = $2`,
    [id, familyId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  const wps = await query<any>(
    `SELECT id, label, kind, seq, arrive_at, depart_at, ST_X(geom) AS lng, ST_Y(geom) AS lat
     FROM visit_waypoints WHERE visit_id = $1 ORDER BY seq ASC`, [id],
  );
  return {
    id: r.id, tripId: r.trip_id, kind: r.kind, title: r.title, notes: r.notes,
    themeId: r.theme_id, color: r.color, icon: r.icon,
    occurredOn: r.occurred_on, occurredEnd: r.occurred_end, properties: r.properties,
    createdBy: r.created_by, createdByName: r.created_by_name, createdAt: r.created_at,
    geometry: r.geom ? JSON.parse(r.geom) : null,
    waypoints: wps.rows.map((w) => ({
      id: w.id, label: w.label, kind: w.kind, seq: w.seq, lng: w.lng, lat: w.lat,
      arriveAt: w.arrive_at, departAt: w.depart_at,
    })),
  };
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

  app.get("/api/visits", async (req) => {
    const { rows } = await query<{ id: string }>(
      "SELECT id FROM visits WHERE family_id = $1 ORDER BY occurred_on NULLS LAST, created_at ASC",
      [req.user.familyId],
    );
    return Promise.all(rows.map((r) => loadVisit(req.user.familyId, r.id)));
  });

  app.post("/api/visits", async (req, reply) => {
    const parsed = visitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const id = await tx(async (client) => {
      const geomJson = b.geometry ? JSON.stringify(b.geometry) : null;
      const res = await client.query<{ id: string }>(
        `INSERT INTO visits (family_id, trip_id, kind, title, notes, theme_id, color, icon, occurred_on, occurred_end, geom, created_by, properties)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           CASE WHEN $11::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($11),4326) END,
           $12, COALESCE($13::jsonb,'{}'::jsonb))
         RETURNING id`,
        [req.user.familyId, b.tripId ?? null, b.kind, b.title, b.notes ?? "", b.themeId ?? null,
         b.color ?? null, b.icon ?? null, b.occurredOn ?? null, b.occurredEnd ?? null, geomJson,
         req.user.id, b.properties ? JSON.stringify(b.properties) : null],
      );
      const vid = res.rows[0].id;
      if (b.waypoints?.length) await insertWaypoints(client, vid, b.waypoints);
      return vid;
    });
    return reply.code(201).send(await loadVisit(req.user.familyId, id));
  });

  app.get("/api/visits/:id", async (req, reply) => {
    const v = await loadVisit(req.user.familyId, (req.params as { id: string }).id);
    if (!v) return reply.code(404).send({ error: "Not found" });
    return v;
  });

  app.patch("/api/visits/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsVisit(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const parsed = visitSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    await tx(async (client) => {
      const geomProvided = Object.prototype.hasOwnProperty.call(b, "geometry");
      const geomJson = b.geometry ? JSON.stringify(b.geometry) : null;
      const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
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
         WHERE id = $1`,
        [id, b.kind ?? null, b.title ?? null, b.notes ?? null,
         has("themeId"), b.themeId ?? null, has("color"), b.color ?? null,
         has("icon"), b.icon ?? null, has("occurredOn"), b.occurredOn ?? null,
         has("occurredEnd"), b.occurredEnd ?? null, has("tripId"), b.tripId ?? null,
         geomProvided, geomJson, has("properties"), b.properties ? JSON.stringify(b.properties) : null],
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
    if (!(await ownsVisit(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    await query("DELETE FROM visits WHERE id = $1", [id]);
    return reply.code(204).send();
  });

  // --- Comments (now on visits) ---
  app.get("/api/visits/:id/comments", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsVisit(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const { rows } = await query<any>(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.display_name AS author
       FROM comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.visit_id = $1 ORDER BY c.created_at ASC`, [id],
    );
    return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at, userId: r.user_id, author: r.author }));
  });

  app.post("/api/visits/:id/comments", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsVisit(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const parsed = z.object({ body: z.string().min(1).max(4000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { rows } = await query<any>(
      `INSERT INTO comments (visit_id, user_id, body) VALUES ($1,$2,$3)
       RETURNING id, body, created_at, user_id`, [id, req.user.id, parsed.data.body],
    );
    const r = rows[0];
    return reply.code(201).send({ id: r.id, body: r.body, createdAt: r.created_at, userId: r.user_id });
  });

  app.delete("/api/comments/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query(
      `DELETE FROM comments c USING visits v
       WHERE c.id = $1 AND c.visit_id = v.id AND v.family_id = $2 AND c.user_id = $3`,
      [id, req.user.familyId, req.user.id],
    );
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });
}
