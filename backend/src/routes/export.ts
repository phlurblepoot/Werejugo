import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

/** Export all of a family's data as a single JSON document (a metadata backup). */
export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/export", async (req, reply) => {
    const familyId = req.user.familyId;

    const family = await query<any>("SELECT name, invite_code, created_at FROM families WHERE id = $1", [familyId]);
    const users = await query<any>(
      "SELECT id, email, display_name, role, color FROM users WHERE family_id = $1",
      [familyId],
    );
    const mapSets = await query<any>("SELECT * FROM map_sets WHERE family_id = $1", [familyId]);
    const trips = await query<any>("SELECT * FROM trips WHERE family_id = $1", [familyId]);
    const themes = await query<any>("SELECT * FROM themes WHERE family_id = $1", [familyId]);
    const icons = await query<any>("SELECT * FROM icons WHERE family_id = $1", [familyId]);
    const items = await query<any>(
      `SELECT i.id, i.map_set_id, i.trip_id, i.kind, i.title, i.notes, i.theme_id,
              i.color, i.icon, i.occurred_on, i.created_at,
              ST_AsGeoJSON(i.geom) AS geom,
              (SELECT json_agg(w) FROM item_waypoints w WHERE w.item_id = i.id) AS waypoints,
              (SELECT json_agg(p) FROM item_photos p WHERE p.item_id = i.id) AS photos,
              (SELECT json_agg(c) FROM item_comments c WHERE c.item_id = i.id) AS comments
       FROM items i JOIN map_sets m ON m.id = i.map_set_id
       WHERE m.family_id = $1`,
      [familyId],
    );

    reply.header("Content-Disposition", `attachment; filename="werejugo-export.json"`);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      family: family.rows[0],
      users: users.rows,
      mapSets: mapSets.rows,
      trips: trips.rows,
      themes: themes.rows,
      icons: icons.rows,
      items: items.rows.map((r) => ({ ...r, geom: r.geom ? JSON.parse(r.geom) : null })),
    };
  });
}
