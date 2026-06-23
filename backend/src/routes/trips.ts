import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

const upsertSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(4000).optional(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  coverPhotoUrl: z.string().nullish(),
  color: z.string().max(40).optional(),
});

interface TripRow {
  id: string; name: string; description: string;
  start_date: string | null; end_date: string | null;
  cover_photo_url: string | null; color: string; created_at: string;
}
const toDto = (r: TripRow) => ({
  id: r.id, name: r.name, description: r.description,
  startDate: r.start_date, endDate: r.end_date,
  coverPhotoUrl: r.cover_photo_url, color: r.color, createdAt: r.created_at,
});

export async function tripRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/trips", async (req) => {
    const { rows } = await query<TripRow>(
      "SELECT * FROM trips WHERE family_id = $1 ORDER BY start_date NULLS LAST, created_at ASC",
      [req.user.familyId]);
    return rows.map(toDto);
  });

  app.post("/api/trips", async (req, reply) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const { rows } = await query<TripRow>(
      `INSERT INTO trips (family_id, name, description, start_date, end_date, cover_photo_url, color, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.familyId, b.name, b.description ?? "", b.startDate || null, b.endDate || null,
       b.coverPhotoUrl ?? null, b.color ?? "#2563eb", req.user.id]);
    return reply.code(201).send(toDto(rows[0]));
  });

  app.patch("/api/trips/:id", async (req, reply) => {
    // TODO(phase-1b): re-home media on trip rename
    const id = (req.params as { id: string }).id;
    const parsed = upsertSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    const { rows } = await query<TripRow>(
      `UPDATE trips SET
         name = COALESCE($3, name), description = COALESCE($4, description),
         start_date = CASE WHEN $5::boolean THEN $6 ELSE start_date END,
         end_date = CASE WHEN $7::boolean THEN $8 ELSE end_date END,
         cover_photo_url = CASE WHEN $9::boolean THEN $10 ELSE cover_photo_url END,
         color = COALESCE($11, color)
       WHERE id = $1 AND family_id = $2 RETURNING *`,
      [id, req.user.familyId, b.name ?? null, b.description ?? null,
       has("startDate"), b.startDate || null, has("endDate"), b.endDate || null,
       has("coverPhotoUrl"), b.coverPhotoUrl ?? null, b.color ?? null]);
    if (!rows[0]) return reply.code(404).send({ error: "Not found" });
    return toDto(rows[0]);
  });

  app.delete("/api/trips/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM trips WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });
}
