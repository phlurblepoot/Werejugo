import { z } from "zod";
import { readableWhere } from "../access.js";
import { uuid, ymd } from "../validate.js";

/**
 * The library's filters, shared by the list, the timeline counts and the map
 * (routes/media.ts), so all three always agree on what's in view.
 */

/** When a photo was taken (or added, when it has no date): the library's order. */
export const SORT_TS = "COALESCE(m.taken_at, m.created_at)";
/** Its month, as "2025-07" (UTC). */
export const MONTH_OF = `to_char(${SORT_TS} AT TIME ZONE 'UTC', 'YYYY-MM')`;

export const filterSchema = z.object({
  trip: uuid.optional(),
  person: uuid.optional(),
  visit: uuid.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  bbox: z.string().max(200).optional(),
  kind: z.enum(["image", "video"]).optional(),
  /** "only": the photos hidden from the library (never shown otherwise). */
  hidden: z.enum(["only"]).optional(),
  /** Photos that aren't in any trip. */
  noTrip: z.enum(["1", "true"]).optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2025-07").optional(),
});
export type MediaFilter = z.infer<typeof filterSchema>;

const linkedTo = (type: string, ph: string) =>
  `EXISTS (SELECT 1 FROM links l WHERE l.family_id = m.family_id
     AND ((l.from_type='media' AND l.from_id=m.id AND l.to_type='${type}' AND l.to_id=${ph})
       OR (l.to_type='media' AND l.to_id=m.id AND l.from_type='${type}' AND l.from_id=${ph})))`;

/**
 * Tagged with this person, or with the same person in another family (an
 * accepted person link), by the photo's own family: "our Grandma is your Grandma".
 */
const taggedWithPerson = (ph: string) => {
  const same = `(SELECT ${ph}::uuid UNION ALL SELECT CASE WHEN pl.person_a = ${ph} THEN pl.person_b ELSE pl.person_a END
                   FROM person_links pl WHERE pl.status = 'accepted' AND ${ph} IN (pl.person_a, pl.person_b))`;
  return `EXISTS (SELECT 1 FROM links l WHERE l.family_id = m.family_id
     AND ((l.from_type = 'media' AND l.from_id = m.id AND l.to_type = 'person' AND l.to_id IN ${same})
       OR (l.to_type = 'media' AND l.to_id = m.id AND l.from_type = 'person' AND l.from_id IN ${same})))`;
};

/** The first day of the month after "YYYY-MM". */
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * WHERE conditions (table alias `m`) for these filters. `$1` is the caller's
 * family; `add` appends more parameters. The library is my family's photos;
 * a trip's album, and a person's photos, are everyone's that I may see.
 */
export function filterSql(q: MediaFilter, familyId: string) {
  const params: unknown[] = [familyId];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const everyones = (q.trip || q.person) && !q.hidden;
  const where: string[] = everyones ? [readableWhere("media", "m", "$1")] : ["m.family_id = $1"];
  if (q.trip) where.push(`m.trip_id = ${add(q.trip)}`);
  where.push(q.hidden === "only" ? "m.hidden_at IS NOT NULL" : "m.hidden_at IS NULL");
  if (q.person) where.push(taggedWithPerson(add(q.person)));
  if (q.visit) where.push(linkedTo("visit", add(q.visit)));
  if (q.kind) where.push(`m.kind = ${add(q.kind)}`);
  if (q.noTrip) where.push("m.trip_id IS NULL");
  if (q.from) where.push(`${SORT_TS}::date >= ${add(q.from)}::date`);
  if (q.to) where.push(`${SORT_TS}::date <= ${add(q.to)}::date`);
  if (q.month) {
    where.push(`${SORT_TS} >= ${add(`${q.month}-01T00:00:00Z`)}::timestamptz`);
    where.push(`${SORT_TS} < ${add(`${nextMonth(q.month)}-01T00:00:00Z`)}::timestamptz`);
  }
  if (q.bbox) {
    const b = q.bbox.split(",").map(Number);
    if (b.length === 4 && b.every(Number.isFinite)) {
      where.push(`m.geom && ST_MakeEnvelope(${add(b[0])},${add(b[1])},${add(b[2])},${add(b[3])},4326)`);
    }
  }
  return { where, params, add };
}
