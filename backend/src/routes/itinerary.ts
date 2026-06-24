import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

interface ItinRow {
  id: string; trip_id: string; title: string; notes: string;
  scheduled_on: string | null; seq: number; lat: number | null; lng: number | null;
  place_label: string; converted_visit_id: string | null; created_at: string;
}
function toDto(r: ItinRow) {
  return {
    id: r.id, tripId: r.trip_id, title: r.title, notes: r.notes,
    scheduledOn: r.scheduled_on, seq: r.seq, lat: r.lat, lng: r.lng,
    placeLabel: r.place_label, convertedVisitId: r.converted_visit_id, createdAt: r.created_at,
  };
}
const SELECT = `SELECT id, trip_id, title, notes, to_char(scheduled_on,'YYYY-MM-DD') AS scheduled_on,
  seq, lat, lng, place_label, converted_visit_id, created_at FROM itinerary_items`;

const itemSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(4000).optional(),
  scheduledOn: z.string().nullish(),
  seq: z.coerce.number().int().optional(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
  placeLabel: z.string().max(200).optional(),
});

async function ownsTrip(familyId: string, tripId: string): Promise<boolean> {
  const { rowCount } = await query("SELECT 1 FROM trips WHERE id = $1 AND family_id = $2", [tripId, familyId]);
  return Boolean(rowCount);
}
async function loadItem(familyId: string, id: string): Promise<ItinRow | null> {
  const { rows } = await query<ItinRow>(`${SELECT} WHERE id = $1 AND family_id = $2`, [id, familyId]);
  return rows[0] ?? null;
}

export async function itineraryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/trips/:tripId/itinerary", async (req, reply) => {
    const tripId = (req.params as { tripId: string }).tripId;
    if (!(await ownsTrip(req.user.familyId, tripId))) return reply.code(404).send({ error: "Trip not found" });
    const { rows } = await query<ItinRow>(
      `${SELECT} WHERE trip_id = $1 ORDER BY scheduled_on ASC NULLS LAST, seq ASC, created_at ASC`, [tripId]);
    return rows.map(toDto);
  });

  app.post("/api/trips/:tripId/itinerary", async (req, reply) => {
    const tripId = (req.params as { tripId: string }).tripId;
    if (!(await ownsTrip(req.user.familyId, tripId))) return reply.code(404).send({ error: "Trip not found" });
    const parsed = itemSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const ins = await query<{ id: string }>(
      `INSERT INTO itinerary_items (family_id, trip_id, title, notes, scheduled_on, seq, lat, lng, place_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.user.familyId, tripId, b.title, b.notes ?? "", b.scheduledOn || null, b.seq ?? 0, b.lat ?? null, b.lng ?? null, b.placeLabel ?? ""]);
    return reply.code(201).send(toDto((await loadItem(req.user.familyId, ins.rows[0].id))!));
  });

  app.patch("/api/itinerary/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await loadItem(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const parsed = itemSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    await query(
      `UPDATE itinerary_items SET
         title = COALESCE($3, title), notes = COALESCE($4, notes),
         scheduled_on = CASE WHEN $5::boolean THEN $6 ELSE scheduled_on END,
         seq = COALESCE($7, seq),
         lat = CASE WHEN $8::boolean THEN $9 ELSE lat END,
         lng = CASE WHEN $10::boolean THEN $11 ELSE lng END,
         place_label = COALESCE($12, place_label)
       WHERE id = $1 AND family_id = $2`,
      [id, req.user.familyId, b.title ?? null, b.notes ?? null,
       has("scheduledOn"), b.scheduledOn || null, b.seq ?? null,
       has("lat"), b.lat ?? null, has("lng"), b.lng ?? null, b.placeLabel ?? null]);
    return toDto((await loadItem(req.user.familyId, id))!);
  });

  app.delete("/api/itinerary/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM itinerary_items WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });

  app.post("/api/itinerary/:id/convert", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const item = await loadItem(req.user.familyId, id);
    if (!item) return reply.code(404).send({ error: "Not found" });
    if (item.converted_visit_id) return { visitId: item.converted_visit_id, item: toDto(item) };

    const visitId = await tx(async (client) => {
      const res = await client.query<{ id: string }>(
        `INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, geom, created_by)
         VALUES ($1,$2,'place',$3,$4,
           CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5,$6),4326) END, $7)
         RETURNING id`,
        [req.user.familyId, item.trip_id, item.title, item.scheduled_on, item.lng, item.lat, req.user.id]);
      const vid = res.rows[0].id;
      await client.query("UPDATE itinerary_items SET converted_visit_id = $1 WHERE id = $2", [vid, id]);
      return vid;
    });
    const updated = await loadItem(req.user.familyId, id);
    return { visitId, item: toDto(updated!) };
  });
}
