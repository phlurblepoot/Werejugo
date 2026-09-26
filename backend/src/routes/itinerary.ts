import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { loadReadable, scopeOf } from "../lib/access.js";
import { notFound } from "../lib/errors.js";
import { optionalYmd } from "../lib/validate.js";
import { lat, lng } from "../lib/geojson.js";

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
  scheduledOn: optionalYmd,
  seq: z.coerce.number().int().min(0).max(100000).optional(),
  lat: lat.nullish(),
  lng: lng.nullish(),
  placeLabel: z.string().max(200).optional(),
});

async function loadItem(familyId: string, id: string): Promise<ItinRow> {
  const { rows } = await query<ItinRow>(`${SELECT} WHERE id = $1 AND family_id = $2`, [id, familyId]);
  if (!rows[0]) throw notFound("Itinerary item not found");
  return rows[0];
}

export async function itineraryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/trips/:tripId/itinerary", async (req) => {
    const tripId = (req.params as { tripId: string }).tripId;
    await loadReadable("trip", tripId, scopeOf(req));
    const { rows } = await query<ItinRow>(
      `${SELECT} WHERE trip_id = $1 AND family_id = $2 ORDER BY scheduled_on ASC NULLS LAST, seq ASC, created_at ASC`,
      [tripId, req.user.familyId]);
    return rows.map(toDto);
  });

  app.post("/api/trips/:tripId/itinerary", async (req, reply) => {
    const tripId = (req.params as { tripId: string }).tripId;
    await loadReadable("trip", tripId, scopeOf(req));
    const b = itemSchema.parse(req.body);
    const ins = await query<{ id: string }>(
      `INSERT INTO itinerary_items (family_id, trip_id, title, notes, scheduled_on, seq, lat, lng, place_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.user.familyId, tripId, b.title, b.notes ?? "", b.scheduledOn ?? null, b.seq ?? 0, b.lat ?? null, b.lng ?? null, b.placeLabel ?? ""]);
    return reply.code(201).send(toDto(await loadItem(req.user.familyId, ins.rows[0].id)));
  });

  app.patch("/api/itinerary/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    await loadItem(req.user.familyId, id);
    const b = itemSchema.partial().parse(req.body);
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
       has("scheduledOn"), b.scheduledOn ?? null, b.seq ?? null,
       has("lat"), b.lat ?? null, has("lng"), b.lng ?? null, b.placeLabel ?? null]);
    return toDto(await loadItem(req.user.familyId, id));
  });

  app.delete("/api/itinerary/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM itinerary_items WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) throw notFound("Itinerary item not found");
    return reply.code(204).send();
  });

  app.post("/api/itinerary/:id/convert", async (req) => {
    const id = (req.params as { id: string }).id;
    const item = await loadItem(req.user.familyId, id);
    if (item.converted_visit_id) return { visitId: item.converted_visit_id, item: toDto(item) };

    const visitId = await tx(async (client) => {
      // Lock the item so two clicks can't make two places.
      const locked = await client.query<{ converted_visit_id: string | null }>(
        "SELECT converted_visit_id FROM itinerary_items WHERE id = $1 AND family_id = $2 FOR UPDATE", [id, req.user.familyId]);
      if (locked.rows[0]?.converted_visit_id) return locked.rows[0].converted_visit_id;
      const res = await client.query<{ id: string }>(
        `INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, geom, created_by)
         VALUES ($1,$2,'place',$3,$4,
           CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5,$6),4326) END, $7)
         RETURNING id`,
        [req.user.familyId, item.trip_id, item.title, item.scheduled_on, item.lng, item.lat, req.user.id]);
      const vid = res.rows[0].id;
      await client.query("UPDATE itinerary_items SET converted_visit_id = $1 WHERE id = $2 AND family_id = $3", [vid, id, req.user.familyId]);
      return vid;
    });
    return { visitId, item: toDto(await loadItem(req.user.familyId, id)) };
  });
}
