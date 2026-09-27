import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { assertRefs, scopeOf } from "../lib/access.js";
import { recordActivity } from "../lib/activity.js";

const idsSchema = z.object({ mediaIds: z.array(z.string().uuid()).min(1).max(500) });

export async function mediaSuggestRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/media/suggestions", async (req) => {
    const ids = idsSchema.parse(req.body).mediaIds;
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

  const applySchema = z.object({
    mediaIds: z.array(z.string().uuid()).min(1).max(500),
    tripId: z.string().uuid().nullable().optional(),
    visitId: z.string().uuid().optional(),
  });

  app.post("/api/media/apply-suggestion", async (req) => {
    const parsed = applySchema.parse(req.body);
    const { tripId, visitId } = parsed;
    const mediaIds = [...new Set(parsed.mediaIds)];
    const scope = scopeOf(req);
    const fam = scope.familyId;
    await assertRefs(scope, { media: mediaIds }, { mode: "own" }); // these photos are changed
    await assertRefs(scope, { trip: tripId, visit: visitId });

    await tx(async (client) => {
      if (tripId !== undefined) {
        for (const id of mediaIds) {
          await client.query("UPDATE media SET trip_id = $1 WHERE id = $2 AND family_id = $3", [tripId, id, fam]);
        }
        await recordActivity({ tripId, familyId: fam, userId: scope.userId, kind: "photo.added",
          summary: `${mediaIds.length} photo${mediaIds.length === 1 ? "" : "s"}` }, client);
      }
      if (visitId) {
        for (const id of mediaIds) {
          await client.query(
            `INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role, created_by)
             VALUES ($1,'media',$2,'visit',$3,'appears_in',$4)
             ON CONFLICT (family_id, from_type, from_id, to_type, to_id, role) DO NOTHING`,
            [fam, id, visitId, req.user.id]);
        }
      }
    });
    return { applied: mediaIds.length };
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
