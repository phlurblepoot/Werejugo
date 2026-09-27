import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { assertRefs, loadReadable, scopeOf, type Scope } from "../lib/access.js";
import { recordActivity } from "../lib/activity.js";
import { requireAuth } from "../lib/auth.js";
import { badRequest } from "../lib/errors.js";
import { createLink } from "../lib/links.js";
import { MEDIA_COLUMNS, mediaDto, type MediaDtoRow } from "../lib/media/dto.js";
import { SORT_TS } from "../lib/media/filters.js";
import { uuid } from "../lib/validate.js";

/**
 * "Add photos" for a place, trip, person or itinerary item: which photos in
 * my library were taken then and there, and attaching the chosen ones.
 */

type TargetType = "visit" | "trip" | "person" | "itinerary";
const TARGET = /^(visit|trip|person|itinerary):([0-9a-f-]{36})$/i;

function parseTarget(raw: string): { type: TargetType; id: string } {
  const m = TARGET.exec(raw);
  if (!m || !uuid.safeParse(m[2]).success) throw badRequest("Photos can't be added to that");
  return { type: m[1].toLowerCase() as TargetType, id: m[2] };
}

/** How near "near" is, in metres. */
const NEAR_M = 2000;

interface Window {
  label: string;
  /** Date ranges (inclusive) the item covers; photos a day either side count. */
  ranges: Array<{ from: string; to: string }>;
  /** Where it is, as GeoJSON (points), or null. */
  place: string | null;
  /** SQL (alias m, parameter `$2` = the target id) for "already added". */
  attached: string;
  tripId?: string | null;
}

const linked = (type: string) =>
  `EXISTS (SELECT 1 FROM links l WHERE l.family_id = m.family_id
     AND ((l.from_type='media' AND l.from_id=m.id AND l.to_type='${type}' AND l.to_id=$2)
       OR (l.to_type='media' AND l.to_id=m.id AND l.from_type='${type}' AND l.from_id=$2)))`;

/** Places as one MultiPoint: points as they are, routes by their two ends. */
const pointsOf = (where: string) =>
  `SELECT ST_AsGeoJSON(ST_Collect(p)) AS g FROM (
     SELECT CASE WHEN GeometryType(v.geom) = 'POINT' THEN v.geom ELSE ST_StartPoint(ST_GeometryN(v.geom, 1)) END AS p FROM visits v WHERE ${where} AND v.geom IS NOT NULL
     UNION ALL
     SELECT ST_EndPoint(ST_GeometryN(v.geom, 1)) FROM visits v WHERE ${where} AND v.geom IS NOT NULL AND GeometryType(v.geom) <> 'POINT'
   ) x WHERE p IS NOT NULL`;

const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

async function windowFor(t: { type: TargetType; id: string }, scope: Scope): Promise<Window> {
  if (t.type === "visit") {
    const v = await loadReadable<{ title: string; occurred_on: Date | null; occurred_end: Date | null }>("visit", t.id, scope, { columns: "t.title, t.occurred_on, t.occurred_end" });
    const place = (await query<{ g: string | null }>(pointsOf("v.id = $1"), [t.id])).rows[0]?.g ?? null;
    return {
      label: v.title,
      ranges: v.occurred_on ? [{ from: iso(v.occurred_on), to: iso(v.occurred_end ?? v.occurred_on) }] : [],
      place, attached: linked("visit"),
    };
  }
  if (t.type === "trip") {
    const trip = await loadReadable<{ name: string; start_date: Date | null; end_date: Date | null }>("trip", t.id, scope, { columns: "t.name, t.start_date, t.end_date" });
    const place = (await query<{ g: string | null }>(pointsOf("v.trip_id = $1"), [t.id])).rows[0]?.g ?? null;
    return {
      label: trip.name,
      ranges: trip.start_date ? [{ from: iso(trip.start_date), to: iso(trip.end_date ?? trip.start_date) }] : [],
      place, attached: "m.trip_id = $2", tripId: t.id,
    };
  }
  if (t.type === "person") {
    const p = await loadReadable<{ display_name: string }>("person", t.id, scope, { columns: "t.display_name" });
    // When they were with us: the trips and places they're tagged in.
    const trips = (await query<{ start_date: Date; end_date: Date | null }>(
      `SELECT t.start_date, t.end_date FROM trips t JOIN links l ON l.family_id = $2
         AND ((l.from_type='person' AND l.from_id=$1 AND l.to_type='trip' AND l.to_id=t.id)
           OR (l.to_type='person' AND l.to_id=$1 AND l.from_type='trip' AND l.from_id=t.id))
        WHERE t.start_date IS NOT NULL LIMIT 50`, [t.id, scope.familyId])).rows;
    const visitsWhere = `v.id IN (SELECT CASE WHEN l.from_type='visit' THEN l.from_id ELSE l.to_id END FROM links l
      WHERE l.family_id = $2 AND ((l.from_type='person' AND l.from_id=$1 AND l.to_type='visit') OR (l.to_type='person' AND l.to_id=$1 AND l.from_type='visit')))`;
    const visits = (await query<{ occurred_on: Date; occurred_end: Date | null }>(
      `SELECT v.occurred_on, v.occurred_end FROM visits v WHERE ${visitsWhere} AND v.occurred_on IS NOT NULL LIMIT 50`, [t.id, scope.familyId])).rows;
    return {
      label: p.display_name,
      ranges: [
        ...trips.map((r) => ({ from: iso(r.start_date), to: iso(r.end_date ?? r.start_date) })),
        ...visits.map((r) => ({ from: iso(r.occurred_on), to: iso(r.occurred_end ?? r.occurred_on) })),
      ],
      place: null, attached: linked("person"),
    };
  }
  const it = await loadReadable<{ title: string; trip_id: string; scheduled_on: Date | null; lat: number | null; lng: number | null; converted_visit_id: string | null }>(
    "itinerary_item", t.id, scope, { columns: "t.title, t.trip_id, t.scheduled_on, t.lat, t.lng, t.converted_visit_id" });
  return {
    label: it.title,
    ranges: it.scheduled_on ? [{ from: iso(it.scheduled_on), to: iso(it.scheduled_on) }] : [],
    place: it.lat !== null && it.lng !== null ? JSON.stringify({ type: "MultiPoint", coordinates: [[it.lng, it.lat]] }) : null,
    // Its place's photos once it has become one; until then it has none of its own.
    attached: `EXISTS (SELECT 1 FROM links l WHERE l.family_id = m.family_id AND l.from_type='media' AND l.from_id=m.id
      AND l.to_type='visit' AND l.to_id = (SELECT converted_visit_id FROM itinerary_items WHERE id = $2))`,
    tripId: it.trip_id,
  };
}

export async function mediaPickerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // The picker's opening view: my photos taken during the item's dates or near
  // its place (both first), and the window, so the library opens at that month.
  app.get("/api/media/for", async (req) => {
    const { entity } = z.object({ entity: z.string().max(80) }).parse(req.query);
    const target = parseTarget(entity);
    const scope = scopeOf(req);
    const w = await windowFor(target, scope);

    const params: unknown[] = [scope.familyId, target.id];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const byDate = w.ranges.length
      ? `(${w.ranges.slice(0, 50).map((r) => `(${SORT_TS}::date BETWEEN ${add(r.from)}::date - 1 AND ${add(r.to)}::date + 1)`).join(" OR ")})`
      : "false";
    const byPlace = w.place
      ? `(m.geom IS NOT NULL AND ST_DWithin(m.geom::geography, ST_SetSRID(ST_GeomFromGeoJSON(${add(w.place)}), 4326)::geography, ${NEAR_M}))`
      : "false";

    const { rows } = await query<MediaDtoRow & { by_date: boolean; by_place: boolean; attached: boolean }>(
      `SELECT ${MEDIA_COLUMNS}, f.name AS family_name, ${byDate} AS by_date, ${byPlace} AS by_place, ${w.attached} AS attached
         FROM media m JOIN families f ON f.id = m.family_id
        WHERE m.family_id = $1 AND m.hidden_at IS NULL AND (${byDate} OR ${byPlace})
        ORDER BY (${byDate})::int + (${byPlace})::int DESC, ${SORT_TS} DESC, m.id DESC
        LIMIT 300`, params);

    const starts = w.ranges.map((r) => r.from).sort();
    const first = rows[0]?.taken_at ?? rows[0]?.created_at;
    return {
      label: w.label,
      window: starts.length ? { from: starts[0], to: w.ranges.map((r) => r.to).sort().at(-1)! } : null,
      near: !!w.place,
      // Where the library should open.
      month: starts.length ? starts.at(-1)!.slice(0, 7) : first ? new Date(first).toISOString().slice(0, 7) : null,
      items: rows.map((r) => ({ ...mediaDto(r), attached: r.attached, match: r.by_date && r.by_place ? "both" : r.by_date ? "date" : "place" })),
    };
  });

  // Attach my chosen photos: links for a place or person, the trip for a trip,
  // and for an itinerary item its trip (and its place once it is one).
  app.post("/api/media/attach", async (req) => {
    const b = z.object({ mediaIds: z.array(uuid).min(1).max(500), to: z.string().max(80) }).parse(req.body);
    const target = parseTarget(b.to);
    const scope = scopeOf(req);
    const ids = [...new Set(b.mediaIds)];
    await assertRefs(scope, { media: ids }, { mode: "own" });

    let tripId: string | null = null;
    let visitId: string | null = null;
    if (target.type === "trip") {
      await assertRefs(scope, { trip: target.id });
      tripId = target.id;
    } else if (target.type === "itinerary") {
      const it = await loadReadable<{ trip_id: string; converted_visit_id: string | null }>("itinerary_item", target.id, scope, { columns: "t.trip_id, t.converted_visit_id" });
      tripId = it.trip_id;
      visitId = it.converted_visit_id;
    }

    const skipped: Array<{ id: string; reason: string }> = [];
    if (tripId) {
      await query("UPDATE media SET trip_id = $1 WHERE id = ANY($2::uuid[]) AND family_id = $3", [tripId, ids, scope.familyId]);
      await recordActivity({ tripId, familyId: scope.familyId, userId: scope.userId, kind: "photo.added",
        summary: `${ids.length} photo${ids.length === 1 ? "" : "s"}` });
    }
    const linkTo = target.type === "visit" || target.type === "person" ? `${target.type}:${target.id}` : visitId ? `visit:${visitId}` : null;
    if (linkTo) {
      const role = linkTo.startsWith("visit:") ? "appears_in" : "";
      for (const id of ids) {
        try {
          await createLink(scope, `media:${id}`, linkTo, role);
        } catch (e) {
          // One photo that can't be linked (say, it's in another trip) doesn't stop the rest.
          if (target.type !== "itinerary" && ids.length === 1) throw e;
          skipped.push({ id, reason: e instanceof Error ? e.message : "couldn't be added" });
        }
      }
    }
    return { attached: ids.length - skipped.length, skipped };
  });
}
