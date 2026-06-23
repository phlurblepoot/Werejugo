import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

const idsSchema = z.object({ mediaIds: z.array(z.string().uuid()).min(1).max(500) });

export async function mediaSuggestRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/media/suggestions", async (req, reply) => {
    const parsed = idsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const ids = parsed.data.mediaIds;
    const fam = req.user.familyId;

    const tripRows = await query<{ trip_id: string; name: string; media_id: string }>(
      `SELECT t.id AS trip_id, t.name, m.id AS media_id
       FROM media m JOIN trips t ON t.family_id = m.family_id
       WHERE m.id = ANY($1::uuid[]) AND m.family_id = $2 AND m.taken_at IS NOT NULL
         AND t.start_date IS NOT NULL
         AND m.taken_at::date >= t.start_date
         AND (t.end_date IS NULL OR m.taken_at::date <= t.end_date)
       ORDER BY t.start_date ASC`,
      [ids, fam]);
    const visitRows = await query<{ visit_id: string; title: string; media_id: string }>(
      `SELECT v.id AS visit_id, v.title, m.id AS media_id
       FROM media m JOIN visits v ON v.family_id = m.family_id
       WHERE m.id = ANY($1::uuid[]) AND m.family_id = $2 AND m.geom IS NOT NULL
         AND v.geom IS NOT NULL AND GeometryType(v.geom) = 'POINT'
         AND ST_DWithin(m.geom::geography, v.geom::geography, 500)`,
      [ids, fam]);

    return { trips: group(tripRows.rows, "trip_id", "name"), visits: group(visitRows.rows, "visit_id", "title") };
  });
}

function group<T extends Record<string, string>>(rows: T[], idKey: keyof T, labelKey: keyof T) {
  const map = new Map<string, { id: string; label: string; mediaIds: string[] }>();
  for (const r of rows) {
    const id = r[idKey] as string;
    const g = map.get(id) ?? { id, label: r[labelKey] as string, mediaIds: [] };
    g.mediaIds.push(r.media_id);
    map.set(id, g);
  }
  return [...map.values()].map((g) =>
    idKey === "trip_id"
      ? { tripId: g.id, name: g.label, mediaIds: g.mediaIds }
      : { visitId: g.id, title: g.label, mediaIds: g.mediaIds },
  );
}
