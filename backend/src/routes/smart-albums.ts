import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { assertRefs, loadEditable, scopeOf } from "../lib/access.js";
import { requireAuth } from "../lib/auth.js";
import { badRequest, HttpError } from "../lib/errors.js";
import { familyConnCached } from "../lib/immich/provision.js";
import { filterSchema } from "../lib/media/filters.js";
import { NO_IMMICH } from "../lib/media/import.js";
import { smartSearchLibrary } from "../lib/media/search.js";

/** Smart search within the library, and smart albums (saved filters and search text). */

/** What a smart album keeps: the library's filters and the search text (empty fields dropped). */
export const albumFiltersSchema = z.preprocess(
  (v) => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x !== null)) : v),
  filterSchema.pick({ person: true, trip: true, visit: true, from: true, to: true, kind: true, noTrip: true })
    .extend({ q: z.string().trim().max(200).optional() })
    .strict(),
);
type AlbumFilters = z.infer<typeof albumFiltersSchema>;

interface AlbumRow { id: string; name: string; filters: AlbumFilters; created_at: string; updated_at: string }
const dto = (r: AlbumRow) => ({ id: r.id, name: r.name, filters: r.filters, createdAt: r.created_at, updatedAt: r.updated_at });
/** Empty values dropped, so a saved album is only what was chosen. */
const clean = (f: AlbumFilters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "")) as AlbumFilters;

export async function smartAlbumRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/media/search", async (req) => {
    const b = filterSchema.omit({ month: true, hidden: true, bbox: true })
      .extend({ q: z.string().trim().min(1).max(200), page: z.coerce.number().int().min(1).max(100).default(1) }).parse(req.query);
    const { q, page, ...f } = b;
    const conn = await familyConnCached(req.user.familyId);
    if (!conn) throw new HttpError(503, NO_IMMICH);
    return smartSearchLibrary(conn, req.user.familyId, q, f, page);
  });

  app.get("/api/smart-albums", async (req) => {
    const { rows } = await query<AlbumRow>("SELECT * FROM smart_albums WHERE family_id = $1 ORDER BY lower(name), created_at", [req.user.familyId]);
    return rows.map(dto);
  });

  app.post("/api/smart-albums", async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(120), filters: albumFiltersSchema }).parse(req.body);
    const scope = scopeOf(req);
    const filters = clean(b.filters);
    if (!Object.keys(filters).length) throw badRequest("Choose a search or a filter first");
    await assertRefs(scope, { person: filters.person, trip: filters.trip, visit: filters.visit });
    const { rows } = await query<AlbumRow>(
      "INSERT INTO smart_albums (family_id, name, filters, created_by) VALUES ($1, $2, $3, $4) RETURNING *",
      [scope.familyId, b.name, JSON.stringify(filters), scope.userId]);
    return reply.code(201).send(dto(rows[0]));
  });

  app.patch("/api/smart-albums/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    await loadEditable("smart_album", id, scope);
    const b = z.object({ name: z.string().trim().min(1).max(120).optional(), filters: albumFiltersSchema.optional() }).parse(req.body);
    const filters = b.filters ? clean(b.filters) : null;
    if (filters && !Object.keys(filters).length) throw badRequest("Choose a search or a filter first");
    if (filters) await assertRefs(scope, { person: filters.person, trip: filters.trip, visit: filters.visit });
    const { rows } = await query<AlbumRow>(
      `UPDATE smart_albums SET name = COALESCE($3, name), filters = COALESCE($4::jsonb, filters), updated_at = now()
        WHERE id = $1 AND family_id = $2 RETURNING *`,
      [id, scope.familyId, b.name ?? null, filters ? JSON.stringify(filters) : null]);
    return dto(rows[0]);
  });

  app.delete("/api/smart-albums/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    await loadEditable("smart_album", id, scope);
    await query("DELETE FROM smart_albums WHERE id = $1 AND family_id = $2", [id, scope.familyId]);
    return reply.code(204).send();
  });
}
