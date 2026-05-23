import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

async function ownsMapSet(familyId: string, mapSetId: string): Promise<boolean> {
  const { rowCount } = await query("SELECT 1 FROM map_sets WHERE id = $1 AND family_id = $2", [
    mapSetId,
    familyId,
  ]);
  return Boolean(rowCount);
}

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/map-sets/:mapSetId/stats", async (req, reply) => {
    const mapSetId = (req.params as { mapSetId: string }).mapSetId;
    if (!(await ownsMapSet(req.user.familyId, mapSetId))) {
      return reply.code(404).send({ error: "Map set not found" });
    }

    // Counts per kind.
    const counts = await query<{ kind: string; n: string }>(
      "SELECT kind, COUNT(*)::int AS n FROM items WHERE map_set_id = $1 GROUP BY kind",
      [mapSetId],
    );

    // Distance per route kind, in metres (geography-aware great-circle length).
    const dist = await query<{ kind: string; meters: number }>(
      `SELECT kind, COALESCE(SUM(ST_Length(geom::geography)), 0) AS meters
       FROM items
       WHERE map_set_id = $1 AND GeometryType(geom) = 'LINESTRING'
       GROUP BY kind`,
      [mapSetId],
    );

    const totals = await query<any>(
      `SELECT
         (SELECT COUNT(*)::int FROM items WHERE map_set_id = $1) AS items,
         (SELECT COUNT(*)::int FROM item_photos p JOIN items i ON i.id = p.item_id WHERE i.map_set_id = $1) AS photos,
         (SELECT COUNT(*)::int FROM trips WHERE map_set_id = $1) AS trips,
         (SELECT MIN(occurred_on) FROM items WHERE map_set_id = $1) AS first_date,
         (SELECT MAX(occurred_on) FROM items WHERE map_set_id = $1) AS last_date`,
      [mapSetId],
    );

    const distanceByKind: Record<string, number> = {};
    for (const r of dist.rows) distanceByKind[r.kind] = Math.round(Number(r.meters));
    const countByKind: Record<string, number> = {};
    for (const r of counts.rows) countByKind[r.kind] = Number(r.n);

    const t = totals.rows[0];
    return {
      items: t.items,
      photos: t.photos,
      trips: t.trips,
      firstDate: t.first_date,
      lastDate: t.last_date,
      countByKind,
      distanceMetersByKind: distanceByKind,
      totalDistanceMeters: Object.values(distanceByKind).reduce((a, b) => a + b, 0),
    };
  });
}
