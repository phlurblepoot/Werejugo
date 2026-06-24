import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { signFileUrl } from "../lib/filesign.js";

interface Hit { type: string; id: string; label: string; thumbUrl: string | null; to: string }

const PER_GROUP = 6;

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/search", async (req) => {
    const fam = req.user.familyId;
    const term = ((req.query as { q?: string }).q ?? "").trim();
    const empty = { people: [], trips: [], visits: [], photos: [], documents: [] };
    if (term.length === 0) return empty;
    const like = `%${term}%`;

    const trips = (await query<any>(
      "SELECT id, name FROM trips WHERE family_id = $1 AND name ILIKE $2 ORDER BY name ASC LIMIT $3",
      [fam, like, PER_GROUP])).rows.map<Hit>((r) => ({ type: "trip", id: r.id, label: r.name, thumbUrl: null, to: `/planning?trip=${r.id}` }));

    const visits = (await query<any>(
      "SELECT id, title FROM visits WHERE family_id = $1 AND title ILIKE $2 ORDER BY title ASC LIMIT $3",
      [fam, like, PER_GROUP])).rows.map<Hit>((r) => ({ type: "visit", id: r.id, label: r.title, thumbUrl: null, to: `/map?visit=${r.id}` }));

    const people = (await query<any>(
      `SELECT p.id, p.display_name, m.rel_path, m.thumb_rel_path
       FROM people p LEFT JOIN media m ON m.id = p.avatar_media_id
       WHERE p.family_id = $1 AND p.display_name ILIKE $2 ORDER BY p.display_name ASC LIMIT $3`,
      [fam, like, PER_GROUP])).rows.map<Hit>((r) => {
        const rel = r.thumb_rel_path ?? r.rel_path;
        return { type: "person", id: r.id, label: r.display_name, thumbUrl: rel ? signFileUrl(rel) : null, to: `/people?person=${r.id}` };
      });

    const photos = (await query<any>(
      `SELECT id, caption, original_name, rel_path, thumb_rel_path FROM media
       WHERE family_id = $1 AND (caption ILIKE $2 OR original_name ILIKE $2) ORDER BY created_at DESC LIMIT $3`,
      [fam, like, PER_GROUP])).rows.map<Hit>((r) => {
        const rel = r.thumb_rel_path ?? r.rel_path;
        return { type: "media", id: r.id, label: r.caption || r.original_name || "Photo", thumbUrl: rel ? signFileUrl(rel) : null, to: `/photos?photo=${r.id}` };
      });

    const documents = (await query<any>(
      "SELECT id, title FROM documents WHERE family_id = $1 AND title ILIKE $2 ORDER BY title ASC LIMIT $3",
      [fam, like, PER_GROUP])).rows.map<Hit>((r) => ({ type: "document", id: r.id, label: r.title, thumbUrl: null, to: `/documents?doc=${r.id}` }));

    return { people, trips, visits, photos, documents };
  });
}
