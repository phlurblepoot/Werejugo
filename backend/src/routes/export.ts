import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

/** Export all of a family's data as a single JSON document (a metadata backup). */
export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/export", async (req, reply) => {
    const familyId = req.user.familyId;

    const family = await query<any>("SELECT name, invite_code, created_at FROM families WHERE id = $1", [familyId]);
    if (!family.rows[0]) return reply.code(404).send({ error: "Family not found" });
    const users = await query<any>(
      "SELECT id, email, display_name, role, color FROM users WHERE family_id = $1",
      [familyId],
    );
    const mapSets = await query<any>("SELECT * FROM map_sets WHERE family_id = $1", [familyId]);
    const trips = await query<any>("SELECT * FROM trips WHERE family_id = $1", [familyId]);
    const themes = await query<any>("SELECT * FROM themes WHERE family_id = $1", [familyId]);
    const icons = await query<any>("SELECT * FROM icons WHERE family_id = $1", [familyId]);
    const people = await query<any>("SELECT * FROM people WHERE family_id = $1", [familyId]);
    const mapSetVisits = await query<any>(
      `SELECT msv.* FROM map_set_visits msv
       JOIN map_sets m ON m.id = msv.map_set_id WHERE m.family_id = $1`,
      [familyId],
    );
    const links = await query<any>("SELECT * FROM links WHERE family_id = $1", [familyId]);
    const visits = await query<any>(
      `SELECT v.id, v.trip_id, v.kind, v.title, v.notes, v.theme_id,
              v.color, v.icon, v.occurred_on, v.occurred_end, v.created_at,
              ST_AsGeoJSON(v.geom) AS geom,
              (SELECT json_agg(w) FROM visit_waypoints w WHERE w.visit_id = v.id) AS waypoints,
              (SELECT json_agg(m) FROM links l
                 JOIN media m ON m.id = CASE WHEN l.from_type = 'media' THEN l.from_id ELSE l.to_id END
                 WHERE l.family_id = v.family_id
                   AND ((l.from_type='media' AND l.to_type='visit' AND l.to_id=v.id)
                     OR (l.to_type='media' AND l.from_type='visit' AND l.from_id=v.id))) AS photos,
              (SELECT json_agg(c) FROM comments c WHERE c.visit_id = v.id) AS comments
       FROM visits v
       WHERE v.family_id = $1`,
      [familyId],
    );

    reply.header("Content-Disposition", `attachment; filename="werejugo-export.json"`);
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      family: family.rows[0],
      users: users.rows,
      mapSets: mapSets.rows,
      mapSetVisits: mapSetVisits.rows,
      trips: trips.rows,
      themes: themes.rows,
      icons: icons.rows,
      people: people.rows,
      links: links.rows,
      visits: visits.rows.map((r) => ({ ...r, geom: r.geom ? JSON.parse(r.geom) : null })),
    };
  });
}
