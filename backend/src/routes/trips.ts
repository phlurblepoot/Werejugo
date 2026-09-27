import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { loadEditable, readableWhere, scopeOf } from "../lib/access.js";
import { badRequest, notFound } from "../lib/errors.js";
import { endsBeforeStart, optionalYmd } from "../lib/validate.js";

const upsertSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(4000).optional(),
  startDate: optionalYmd,
  endDate: optionalYmd,
  coverPhotoUrl: z.string().max(2000).nullish(),
  color: z.string().max(40).optional(),
  status: z.enum(["idea", "planning", "booked", "done"]).optional(),
});

interface TripRow {
  id: string; name: string; description: string;
  start_date: string | null; end_date: string | null;
  cover_photo_url: string | null; color: string; status: string; created_at: string;
  family_id: string; host_family_name: string; my_role: "host" | "coowner" | "contributor"; guest_count: number;
}
const toDto = (r: TripRow) => ({
  id: r.id, name: r.name, description: r.description,
  startDate: r.start_date, endDate: r.end_date,
  coverPhotoUrl: r.cover_photo_url, color: r.color, status: r.status, createdAt: r.created_at,
  // Sharing: my family's role, who hosts it, and how many other families are on it.
  role: r.my_role, hostFamilyId: r.family_id, hostFamilyName: r.host_family_name,
  guestFamilies: r.guest_count, shared: r.guest_count > 0 || r.my_role !== "host",
});

/** Trips with my family's role on each ($1 = my family). */
const SELECT = `
  SELECT t.*, f.name AS host_family_name,
         CASE WHEN t.family_id = $1 THEN 'host'
              ELSE (SELECT role FROM trip_members WHERE trip_id = t.id AND family_id = $1) END AS my_role,
         (SELECT count(*)::int FROM trip_members WHERE trip_id = t.id) AS guest_count
    FROM trips t JOIN families f ON f.id = t.family_id`;

async function loadTrip(familyId: string, id: string): Promise<TripRow> {
  const { rows } = await query<TripRow>(`${SELECT} WHERE t.id = $2 AND ${readableWhere("trip", "t", "$1")}`, [familyId, id]);
  if (!rows[0]) throw notFound("Trip not found");
  return rows[0];
}

const DATE_ORDER = "The trip can't end before it starts";

export async function tripRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/trips", async (req) => {
    const { rows } = await query<TripRow>(
      `${SELECT} WHERE ${readableWhere("trip", "t", "$1")} ORDER BY t.start_date NULLS LAST, t.created_at ASC`,
      [req.user.familyId]);
    return rows.map(toDto);
  });

  app.post("/api/trips", async (req, reply) => {
    const b = upsertSchema.parse(req.body);
    if (endsBeforeStart(b.startDate, b.endDate)) throw badRequest(DATE_ORDER);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO trips (family_id, name, description, start_date, end_date, cover_photo_url, color, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.user.familyId, b.name, b.description ?? "", b.startDate ?? null, b.endDate ?? null,
       b.coverPhotoUrl ?? null, b.color ?? "#2563eb", b.status ?? "idea", req.user.id]);
    return reply.code(201).send(toDto(await loadTrip(req.user.familyId, rows[0].id)));
  });

  app.patch("/api/trips/:id", async (req) => {
    // TODO(phase-1b): re-home media on trip rename
    const id = (req.params as { id: string }).id;
    const current = await loadEditable<{ start_date: string | null; end_date: string | null }>("trip", id, scopeOf(req));
    const b = upsertSchema.partial().parse(req.body);
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    if (endsBeforeStart(has("startDate") ? b.startDate : current.start_date, has("endDate") ? b.endDate : current.end_date)) {
      throw badRequest(DATE_ORDER);
    }
    const { rows } = await query<{ id: string }>(
      `UPDATE trips SET
         name = COALESCE($3, name), description = COALESCE($4, description),
         start_date = CASE WHEN $5::boolean THEN $6 ELSE start_date END,
         end_date = CASE WHEN $7::boolean THEN $8 ELSE end_date END,
         cover_photo_url = CASE WHEN $9::boolean THEN $10 ELSE cover_photo_url END,
         color = COALESCE($11, color),
         status = COALESCE($12, status)
       WHERE id = $1 AND family_id = $2 RETURNING id`,
      [id, req.user.familyId, b.name ?? null, b.description ?? null,
       has("startDate"), b.startDate ?? null, has("endDate"), b.endDate ?? null,
       has("coverPhotoUrl"), b.coverPhotoUrl ?? null, b.color ?? null, b.status ?? null]);
    if (!rows[0]) throw notFound("Trip not found");
    return toDto(await loadTrip(req.user.familyId, id));
  });

  app.delete("/api/trips/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM trips WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) throw notFound("Trip not found");
    return reply.code(204).send();
  });
}
