import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Family-scoped stats over the whole shared core (visits are the atom).
  app.get("/api/stats", async (req) => {
    const familyId = req.user.familyId;

    // Counts per kind.
    const counts = await query<{ kind: string; n: string }>(
      "SELECT kind, COUNT(*)::int AS n FROM visits WHERE family_id = $1 GROUP BY kind",
      [familyId],
    );

    // Distance per route kind, in metres (geography-aware great-circle length).
    const dist = await query<{ kind: string; meters: number }>(
      `SELECT kind, COALESCE(SUM(ST_Length(geom::geography)), 0) AS meters
       FROM visits
       WHERE family_id = $1 AND GeometryType(geom) = 'LINESTRING'
       GROUP BY kind`,
      [familyId],
    );

    const totals = await query<any>(
      `SELECT
         (SELECT COUNT(*)::int FROM visits WHERE family_id = $1) AS items,
         (SELECT COUNT(*)::int FROM media WHERE family_id = $1) AS photos,
         (SELECT COUNT(*)::int FROM trips WHERE family_id = $1) AS trips,
         (SELECT MIN(occurred_on) FROM visits WHERE family_id = $1) AS first_date,
         (SELECT MAX(occurred_on) FROM visits WHERE family_id = $1) AS last_date`,
      [familyId],
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
