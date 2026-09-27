import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { editableWhere, loadReadable, readableWhere, scopeOf } from "../lib/access.js";
import { recordActivity } from "../lib/activity.js";
import { notFound } from "../lib/errors.js";
import { optionalYmd } from "../lib/validate.js";
import { lat, lng } from "../lib/geojson.js";

interface ItinRow {
  id: string; trip_id: string; title: string; notes: string;
  scheduled_on: string | null; seq: number; lat: number | null; lng: number | null;
  place_label: string; converted_visit_id: string | null; created_at: string;
  family_id: string; family_name: string; created_by_name: string | null; can_edit: boolean;
}
function toDto(r: ItinRow) {
  return {
    id: r.id, tripId: r.trip_id, title: r.title, notes: r.notes,
    scheduledOn: r.scheduled_on, seq: r.seq, lat: r.lat, lng: r.lng,
    placeLabel: r.place_label, convertedVisitId: r.converted_visit_id, createdAt: r.created_at,
    familyId: r.family_id, familyName: r.family_name, createdByName: r.created_by_name, canEdit: r.can_edit,
  };
}
// $1 = my family. `t` is the item; canEdit follows the trip roles.
const SELECT = `SELECT t.id, t.trip_id, t.title, t.notes, to_char(t.scheduled_on,'YYYY-MM-DD') AS scheduled_on,
  t.seq, t.lat, t.lng, t.place_label, t.converted_visit_id, t.created_at,
  t.family_id, f.name AS family_name, u.display_name AS created_by_name,
  ${editableWhere("itinerary_item", "t", "$1")} AS can_edit
  FROM itinerary_items t JOIN families f ON f.id = t.family_id LEFT JOIN users u ON u.id = t.created_by`;

const itemSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(4000).optional(),
  scheduledOn: optionalYmd,
  seq: z.coerce.number().int().min(0).max(100000).optional(),
  lat: lat.nullish(),
  lng: lng.nullish(),
  placeLabel: z.string().max(200).optional(),
});

async function loadItem(familyId: string, id: string, mode: "read" | "edit" = "read"): Promise<ItinRow> {
  const cond = mode === "edit" ? editableWhere("itinerary_item", "t", "$1") : readableWhere("itinerary_item", "t", "$1");
  const { rows } = await query<ItinRow>(`${SELECT} WHERE t.id = $2 AND ${cond}`, [familyId, id]);
  if (!rows[0]) throw notFound("Itinerary item not found");
  return rows[0];
}

export async function itineraryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/trips/:tripId/itinerary", async (req) => {
    const tripId = (req.params as { tripId: string }).tripId;
    await loadReadable("trip", tripId, scopeOf(req));
    const { rows } = await query<ItinRow>(
      `${SELECT} WHERE t.trip_id = $2 AND ${readableWhere("itinerary_item", "t", "$1")}
        ORDER BY t.scheduled_on ASC NULLS LAST, t.seq ASC, t.created_at ASC`,
      [req.user.familyId, tripId]);
    return rows.map(toDto);
  });

  app.post("/api/trips/:tripId/itinerary", async (req, reply) => {
    const tripId = (req.params as { tripId: string }).tripId;
    const scope = scopeOf(req);
    await loadReadable("trip", tripId, scope); // every family on the trip may add to it
    const b = itemSchema.parse(req.body);
    const ins = await query<{ id: string }>(
      `INSERT INTO itinerary_items (family_id, trip_id, title, notes, scheduled_on, seq, lat, lng, place_label, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [scope.familyId, tripId, b.title, b.notes ?? "", b.scheduledOn ?? null, b.seq ?? 0, b.lat ?? null, b.lng ?? null, b.placeLabel ?? "", scope.userId]);
    await recordActivity({ tripId, familyId: scope.familyId, userId: scope.userId, kind: "itinerary.added", targetType: "itinerary_item", targetId: ins.rows[0].id, summary: b.title });
    return reply.code(201).send(toDto(await loadItem(req.user.familyId, ins.rows[0].id)));
  });

  app.patch("/api/itinerary/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    await loadItem(req.user.familyId, id, "edit");
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
       WHERE id = $1 AND ${editableWhere("itinerary_item", "itinerary_items", "$2")}`,
      [id, req.user.familyId, b.title ?? null, b.notes ?? null,
       has("scheduledOn"), b.scheduledOn ?? null, b.seq ?? null,
       has("lat"), b.lat ?? null, has("lng"), b.lng ?? null, b.placeLabel ?? null]);
    return toDto(await loadItem(req.user.familyId, id));
  });

  app.delete("/api/itinerary/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query(`DELETE FROM itinerary_items WHERE id = $1 AND ${editableWhere("itinerary_item", "itinerary_items", "$2")}`, [id, req.user.familyId]);
    if (!res.rowCount) throw notFound("Itinerary item not found");
    return reply.code(204).send();
  });

  app.post("/api/itinerary/:id/convert", async (req) => {
    const id = (req.params as { id: string }).id;
    const item = await loadItem(req.user.familyId, id, "edit");
    if (item.converted_visit_id) return { visitId: item.converted_visit_id, item: toDto(item) };

    const visitId = await tx(async (client) => {
      // Lock the item so two clicks can't make two places.
      const locked = await client.query<{ converted_visit_id: string | null }>(
        "SELECT converted_visit_id FROM itinerary_items WHERE id = $1 FOR UPDATE", [id]);
      if (locked.rows[0]?.converted_visit_id) return locked.rows[0].converted_visit_id;
      const res = await client.query<{ id: string }>(
        `INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, geom, created_by)
         VALUES ($1,$2,'place',$3,$4,
           CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5,$6),4326) END, $7)
         RETURNING id`,
        [req.user.familyId, item.trip_id, item.title, item.scheduled_on, item.lng, item.lat, req.user.id]);
      const vid = res.rows[0].id;
      await client.query("UPDATE itinerary_items SET converted_visit_id = $1 WHERE id = $2", [vid, id]);
      await recordActivity({ tripId: item.trip_id, familyId: req.user.familyId, userId: req.user.id, kind: "visit.added", targetType: "visit", targetId: vid, summary: item.title }, client);
      return vid;
    });
    return { visitId, item: toDto(await loadItem(req.user.familyId, id)) };
  });
}
