import { query, tx } from "../db/pool.js";
import { assertRefs, loadReadable, readableWhere, type Scope } from "./access.js";
import { recordActivity } from "./activity.js";
import { notFound, badRequest } from "./errors.js";
import { createLink } from "./links.js";
import { signMediaUrl } from "./media/urls.js";

/**
 * Suggestions from photos: what the dates, Immich's place names and the faces
 * say is missing. Computed when asked (no stored state but dismissals). Each
 * has a stable key, so applying or dismissing one checks it again here.
 *
 *   trip-photos:<trip>              my photos taken during the trip, in no trip
 *   trip-place:<trip>:<lat>,<lng>   a spot I took photos at, not yet a place on the trip
 *   trip-person:<trip>:<person>     someone in my photos of the trip, not linked to it
 *   visit-photos:<visit>            my photos taken there and then, not linked to it
 *   new-trip:<from>:<to>:<lat>,<lng> photos away from home, in no trip: a trip that doesn't exist yet
 */

export type SuggestionKind = "trip-photos" | "trip-place" | "trip-person" | "visit-photos" | "new-trip";

export interface Suggestion {
  key: string;
  kind: SuggestionKind;
  count: number;
  thumbUrls: string[];
  tripId?: string;
  visitId?: string;
  person?: { id: string; displayName: string; familyName: string | null };
  /** A place or a new trip: where (Immich's place names), and when. */
  label?: string | null;
  lat?: number;
  lng?: number;
  startDate?: string;
  endDate?: string;
  /** A new trip's suggested name. */
  name?: string;
  /** The photos it's about (not sent to the browser). */
  mediaIds: string[];
}

/** Photos near one of a trip's places count as the trip's (when it has places). */
const TRIP_RADIUS_M = 50_000;
/** Photos within this of a place and its dates are its photos. */
const VISIT_RADIUS_M = 2_000;
/** A spot: photos within about this many metres of each other (DBSCAN, web-mercator metres). */
const SPOT_EPS = 400;
const SPOT_MIN = 3;
/** A spot this close to a place on the trip is that place. */
const SPOT_KNOWN_M = 1_000;
/** Away from home: further than this. */
const AWAY_KM = 50;
/** A trip found in photos: no gap longer than this between photos, and at least this many. */
const RUN_GAP_MS = 2 * 24 * 3600_000;
const RUN_MIN = 6;
/** A home needs photos on at least this many days in one area. */
const HOME_MIN_DAYS = 5;

const thumbs = (ids: string[]) => ids.slice(0, 4).map((id) => signMediaUrl(id, "thumbnail"));
const day = (d: Date | string | number) => new Date(d).toISOString().slice(0, 10);

async function dismissedAt(familyId: string, key: string): Promise<Date | null> {
  const r = (await query<{ dismissed_at: Date }>("SELECT dismissed_at FROM suggestion_dismissals WHERE family_id = $1 AND key = $2", [familyId, key])).rows[0];
  return r?.dismissed_at ?? null;
}
async function dismissedKeys(familyId: string, prefix: string): Promise<Set<string>> {
  return new Set((await query<{ key: string }>(
    "SELECT key FROM suggestion_dismissals WHERE family_id = $1 AND key LIKE $2", [familyId, `${prefix}%`])).rows.map((r) => r.key));
}

// ---- A trip ----

export async function forTrip(scope: Scope, tripId: string): Promise<Suggestion[]> {
  const trip = await loadReadable<{ id: string; start_date: string | null; end_date: string | null }>(
    "trip", tripId, scope, { columns: "t.id, t.start_date::text AS start_date, t.end_date::text AS end_date" });
  const out: Suggestion[] = [];
  const photos = await tripPhotos(scope, trip);
  if (photos) out.push(photos);
  out.push(...await tripPlaces(scope, tripId));
  out.push(...await tripPeople(scope, tripId));
  return out;
}

async function tripPhotos(scope: Scope, trip: { id: string; start_date: string | null; end_date: string | null }): Promise<Suggestion | null> {
  if (!trip.start_date) return null;
  const key = `trip-photos:${trip.id}`;
  const since = await dismissedAt(scope.familyId, key);
  const ids = (await query<{ id: string }>(
    `SELECT m.id FROM media m
      WHERE m.family_id = $1 AND m.trip_id IS NULL AND m.hidden_at IS NULL AND m.taken_at IS NOT NULL
        AND m.taken_at >= ($3::date - 1) AND m.taken_at < ($4::date + 2)
        AND (m.geom IS NULL
             OR NOT EXISTS (SELECT 1 FROM visits v WHERE v.trip_id = $2 AND v.geom IS NOT NULL)
             OR EXISTS (SELECT 1 FROM visits v WHERE v.trip_id = $2 AND v.geom IS NOT NULL
                          AND ST_DWithin(m.geom::geography, v.geom::geography, ${TRIP_RADIUS_M})))
        AND ($5::timestamptz IS NULL OR m.created_at > $5)
      ORDER BY m.taken_at, m.id`,
    [scope.familyId, trip.id, trip.start_date, trip.end_date ?? trip.start_date, since])).rows.map((r) => r.id);
  if (!ids.length) return null;
  return { key, kind: "trip-photos", tripId: trip.id, count: ids.length, thumbUrls: thumbs(ids), mediaIds: ids };
}

async function tripPlaces(scope: Scope, tripId: string): Promise<Suggestion[]> {
  const dismissed = await dismissedKeys(scope.familyId, `trip-place:${tripId}:`);
  const rows = (await query<{ n: number; lat: number; lng: number; first: Date; city: string | null; ids: string[] }>(
    `WITH pts AS (
       SELECT m.id, m.geom, m.taken_at, m.city,
              ST_ClusterDBSCAN(ST_Transform(m.geom, 3857), eps := ${SPOT_EPS}, minpoints := ${SPOT_MIN}) OVER () AS cid
         FROM media m
        WHERE m.family_id = $1 AND m.trip_id = $2 AND m.geom IS NOT NULL AND m.hidden_at IS NULL
     ), spots AS (
       SELECT count(*)::int AS n, ST_Centroid(ST_Collect(geom)) AS c, min(taken_at) AS first,
              mode() WITHIN GROUP (ORDER BY city) AS city, array_agg(id ORDER BY taken_at, id) AS ids
         FROM pts WHERE cid IS NOT NULL GROUP BY cid
     )
     SELECT n, ST_Y(c) AS lat, ST_X(c) AS lng, first, city, ids FROM spots
      WHERE NOT EXISTS (SELECT 1 FROM visits v WHERE v.trip_id = $2 AND v.geom IS NOT NULL
                          AND ST_DWithin(v.geom::geography, spots.c::geography, ${SPOT_KNOWN_M}))
      ORDER BY n DESC, first LIMIT 20`, [scope.familyId, tripId])).rows;
  return rows
    .map((r): Suggestion => ({
      key: `trip-place:${tripId}:${r.lat.toFixed(3)},${r.lng.toFixed(3)}`, kind: "trip-place", tripId,
      count: r.n, thumbUrls: thumbs(r.ids), label: r.city, lat: r.lat, lng: r.lng, startDate: day(r.first), mediaIds: r.ids,
    }))
    .filter((s) => !dismissed.has(s.key))
    .slice(0, 8);
}

async function tripPeople(scope: Scope, tripId: string): Promise<Suggestion[]> {
  const dismissed = await dismissedKeys(scope.familyId, `trip-person:${tripId}:`);
  const rows = (await query<{ id: string; display_name: string; family_id: string; family_name: string; n: number; ids: string[] }>(
    `SELECT p.id, p.display_name, p.family_id, f.name AS family_name, count(DISTINCT m.id)::int AS n,
            (array_agg(DISTINCT m.id))[1:4] AS ids
       FROM media m
       JOIN links l ON l.family_id = m.family_id AND l.from_type = 'media' AND l.from_id = m.id AND l.to_type = 'person'
       JOIN people p ON p.id = l.to_id
       JOIN families f ON f.id = p.family_id
      WHERE m.family_id = $1 AND m.trip_id = $2 AND m.hidden_at IS NULL AND ${readableWhere("person", "p", "$1")}
        AND NOT EXISTS (SELECT 1 FROM links x
                         WHERE (x.from_type = 'person' AND x.from_id = p.id AND x.to_type = 'trip' AND x.to_id = $2)
                            OR (x.from_type = 'trip' AND x.from_id = $2 AND x.to_type = 'person' AND x.to_id = p.id))
      GROUP BY p.id, f.name
     HAVING count(DISTINCT m.id) >= 2
      ORDER BY n DESC, p.display_name LIMIT 20`, [scope.familyId, tripId])).rows;
  return rows
    .map((r): Suggestion => ({
      key: `trip-person:${tripId}:${r.id}`, kind: "trip-person", tripId, count: r.n, thumbUrls: thumbs(r.ids),
      person: { id: r.id, displayName: r.display_name, familyName: r.family_id === scope.familyId ? null : r.family_name }, mediaIds: [],
    }))
    .filter((s) => !dismissed.has(s.key))
    .slice(0, 10);
}

// ---- A place ----

export async function forVisit(scope: Scope, visitId: string): Promise<Suggestion[]> {
  const v = await loadReadable<{ id: string; trip_id: string | null; occurred_on: string | null; occurred_end: string | null; has_geom: boolean }>(
    "visit", visitId, scope, { columns: "t.id, t.trip_id, t.occurred_on::text AS occurred_on, t.occurred_end::text AS occurred_end, t.geom IS NOT NULL AS has_geom" });
  if (!v.occurred_on || !v.has_geom) return [];
  const key = `visit-photos:${visitId}`;
  const since = await dismissedAt(scope.familyId, key);
  const ids = (await query<{ id: string }>(
    `SELECT m.id FROM media m, visits v
      WHERE v.id = $2 AND m.family_id = $1 AND m.hidden_at IS NULL AND m.geom IS NOT NULL AND m.taken_at IS NOT NULL
        AND ST_DWithin(m.geom::geography, v.geom::geography, ${VISIT_RADIUS_M})
        AND m.taken_at >= ($3::date - 1) AND m.taken_at < ($4::date + 2)
        AND (v.trip_id IS NULL OR m.trip_id IS NULL OR m.trip_id = v.trip_id)
        AND NOT EXISTS (SELECT 1 FROM links l WHERE l.family_id = m.family_id
                          AND ((l.from_type = 'media' AND l.from_id = m.id AND l.to_type = 'visit' AND l.to_id = v.id)
                            OR (l.to_type = 'media' AND l.to_id = m.id AND l.from_type = 'visit' AND l.from_id = v.id)))
        AND ($5::timestamptz IS NULL OR m.created_at > $5)
      ORDER BY m.taken_at, m.id`,
    [scope.familyId, visitId, v.occurred_on, v.occurred_end ?? v.occurred_on, since])).rows.map((r) => r.id);
  return ids.length ? [{ key, kind: "visit-photos", visitId, tripId: v.trip_id ?? undefined, count: ids.length, thumbUrls: thumbs(ids), mediaIds: ids }] : [];
}

// ---- The library: trips found in the photos ----

interface Pt { id: string; t: number; lat: number; lng: number; city: string | null; country: string | null; tripId: string | null }

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12_742 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Where the family lives, going by photos: the area with photos on the most days. */
export function inferHome(pts: Array<{ t: number; lat: number; lng: number }>): { lat: number; lng: number } | null {
  const cells = new Map<string, { days: Set<string>; lat: number; lng: number; n: number }>();
  for (const p of pts) {
    const k = `${Math.floor(p.lat * 2)}:${Math.floor(p.lng * 2)}`;
    const c = cells.get(k) ?? { days: new Set<string>(), lat: 0, lng: 0, n: 0 };
    c.days.add(day(p.t));
    c.lat += p.lat;
    c.lng += p.lng;
    c.n++;
    cells.set(k, c);
  }
  let best: { days: Set<string>; lat: number; lng: number; n: number } | null = null;
  for (const c of cells.values()) if (!best || c.days.size > best.days.size) best = c;
  return best && best.days.size >= HOME_MIN_DAYS ? { lat: best.lat / best.n, lng: best.lng / best.n } : null;
}

/** "Lisbon", "Lisbon and Porto", or the country. */
function placeLabel(pts: Pt[]): string | null {
  const count = (vals: Array<string | null>) => {
    const m = new Map<string, number>();
    for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const cities = count(pts.map((p) => p.city));
  if (cities.length) {
    const [first, second] = cities;
    return second && second[1] >= pts.length / 4 ? `${first[0]} and ${second[0]}` : first[0];
  }
  return count(pts.map((p) => p.country))[0]?.[0] ?? null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function tripName(label: string | null, from: string, to: string): string {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const when = fy === ty && fm === tm ? `${MONTHS[fm - 1]} ${fy}` : fy === ty ? `${MONTHS[fm - 1]}–${MONTHS[tm - 1]} ${fy}` : `${MONTHS[fm - 1]} ${fy}–${MONTHS[tm - 1]} ${ty}`;
  return `${label ?? "A trip"}, ${when}`;
}

export async function forLibrary(scope: Scope): Promise<Suggestion[]> {
  const fam = scope.familyId;
  const pts: Pt[] = (await query<{ id: string; t: Date; lat: number; lng: number; city: string | null; country: string | null; trip_id: string | null }>(
    `SELECT id, taken_at AS t, ST_Y(geom) AS lat, ST_X(geom) AS lng, city, country, trip_id FROM media
      WHERE family_id = $1 AND hidden_at IS NULL AND taken_at IS NOT NULL AND geom IS NOT NULL ORDER BY taken_at, id`, [fam])).rows
    .map((r) => ({ id: r.id, t: new Date(r.t).getTime(), lat: r.lat, lng: r.lng, city: r.city, country: r.country, tripId: r.trip_id }));
  const home = inferHome(pts);
  // The family's trips' dates (±1 day): photos then are those trips' suggestions instead.
  const spans = (await query<{ s: Date; e: Date }>(
    `SELECT (t.start_date - 1)::timestamptz AS s, (COALESCE(t.end_date, t.start_date) + 2)::timestamptz AS e FROM trips t
      WHERE t.start_date IS NOT NULL
        AND (t.family_id = $1 OR EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.family_id = $1))`, [fam])).rows
    .map((r) => [new Date(r.s).getTime(), new Date(r.e).getTime()] as const);
  const inATrip = (t: number) => spans.some(([s, e]) => t >= s && t < e);
  const away = pts.filter((p) => !p.tripId && !inATrip(p.t) && (!home || km(home, p) > AWAY_KM));

  const runs: Pt[][] = [];
  for (const p of away) {
    const run = runs[runs.length - 1];
    if (run && p.t - run[run.length - 1].t <= RUN_GAP_MS) run.push(p);
    else runs.push([p]);
  }
  const kept = runs.filter((r) => r.length >= RUN_MIN);
  if (!kept.length) return [];

  // Photos with no location taken during a run belong to it too.
  const unplaced = (await query<{ id: string; t: Date }>(
    `SELECT id, taken_at AS t FROM media WHERE family_id = $1 AND trip_id IS NULL AND hidden_at IS NULL
        AND taken_at IS NOT NULL AND geom IS NULL ORDER BY taken_at`, [fam])).rows.map((r) => ({ id: r.id, t: new Date(r.t).getTime() }));
  const dismissed = await dismissedKeys(fam, "new-trip:");

  return kept
    .map((run): Suggestion => {
      const from = day(run[0].t);
      const to = day(run[run.length - 1].t);
      const lat = run.reduce((a, p) => a + p.lat, 0) / run.length;
      const lng = run.reduce((a, p) => a + p.lng, 0) / run.length;
      const extra = unplaced.filter((u) => u.t >= run[0].t && u.t <= run[run.length - 1].t).map((u) => u.id);
      const ids = [...run.map((p) => p.id), ...extra];
      const label = placeLabel(run);
      return {
        key: `new-trip:${from}:${to}:${lat.toFixed(1)},${lng.toFixed(1)}`, kind: "new-trip", count: ids.length,
        thumbUrls: thumbs(run.map((p) => p.id)), label, lat, lng, startDate: from, endDate: to, name: tripName(label, from, to), mediaIds: ids,
      };
    })
    .filter((s) => !dismissed.has(s.key))
    .reverse()
    .slice(0, 20);
}

// ---- Applying and dismissing ----

const KEY = /^(trip-photos|trip-place|trip-person|visit-photos|new-trip):[-0-9a-f:.,]+$/;

/** The suggestion with this key as it stands now (checking access), or a 404. */
export async function findSuggestion(scope: Scope, key: string): Promise<Suggestion> {
  if (!KEY.test(key)) throw badRequest("Unknown suggestion");
  const [kind, target] = key.split(":");
  const list = kind === "new-trip" ? await forLibrary(scope)
    : kind === "visit-photos" ? await forVisit(scope, target)
    : kind === "trip-photos" ? await tripPhotosFor(scope, target)
    : kind === "trip-place" ? (await loadReadable("trip", target, scope), await tripPlaces(scope, target))
    : (await loadReadable("trip", target, scope), await tripPeople(scope, target));
  const found = list.find((s) => s.key === key);
  if (!found) throw notFound("This suggestion has changed; have another look");
  return found;
}

async function tripPhotosFor(scope: Scope, tripId: string): Promise<Suggestion[]> {
  const trip = await loadReadable<{ id: string; start_date: string | null; end_date: string | null }>(
    "trip", tripId, scope, { columns: "t.id, t.start_date::text AS start_date, t.end_date::text AS end_date" });
  const s = await tripPhotos(scope, trip);
  return s ? [s] : [];
}

export interface Applied { tripId?: string; visitId?: string; attached?: number; linked?: boolean }

export async function applySuggestion(scope: Scope, key: string, opts: { name?: string } = {}): Promise<Applied> {
  const s = await findSuggestion(scope, key);
  const fam = scope.familyId;
  const count = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;
  switch (s.kind) {
    case "trip-photos": {
      const r = await query("UPDATE media SET trip_id = $1 WHERE id = ANY($2::uuid[]) AND family_id = $3 AND trip_id IS NULL", [s.tripId, s.mediaIds, fam]);
      const n = r.rowCount ?? 0;
      await recordActivity({ tripId: s.tripId, familyId: fam, userId: scope.userId, kind: "photo.added", summary: count(n) });
      return { tripId: s.tripId, attached: n };
    }
    case "trip-place": {
      await assertRefs(scope, { trip: s.tripId });
      const title = opts.name?.trim() || s.label || "New place";
      const visitId = await tx(async (client) => {
        const id = (await client.query<{ id: string }>(
          `INSERT INTO visits (family_id, trip_id, kind, title, occurred_on, geom, created_by)
           VALUES ($1, $2, 'place', $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7) RETURNING id`,
          [fam, s.tripId, title, s.startDate, s.lng, s.lat, scope.userId])).rows[0].id;
        await recordActivity({ tripId: s.tripId, familyId: fam, userId: scope.userId, kind: "visit.added", targetType: "visit", targetId: id, summary: title }, client);
        return id;
      });
      let attached = 0;
      for (const id of s.mediaIds) {
        await createLink(scope, `media:${id}`, `visit:${visitId}`, "appears_in").then(() => attached++, () => {});
      }
      return { tripId: s.tripId, visitId, attached };
    }
    case "trip-person":
      await createLink(scope, `person:${s.person!.id}`, `trip:${s.tripId}`, "");
      return { tripId: s.tripId, linked: true };
    case "visit-photos": {
      let attached = 0;
      for (const id of s.mediaIds) {
        await createLink(scope, `media:${id}`, `visit:${s.visitId}`, "appears_in").then(() => attached++, () => {});
      }
      return { visitId: s.visitId, attached };
    }
    case "new-trip": {
      const name = opts.name?.trim() || s.name!;
      const tripId = await tx(async (client) => {
        const id = (await client.query<{ id: string }>(
          `INSERT INTO trips (family_id, name, start_date, end_date, status, created_by) VALUES ($1, $2, $3, $4, 'done', $5) RETURNING id`,
          [fam, name, s.startDate, s.endDate, scope.userId])).rows[0].id;
        await client.query("UPDATE media SET trip_id = $1 WHERE id = ANY($2::uuid[]) AND family_id = $3 AND trip_id IS NULL", [id, s.mediaIds, fam]);
        return id;
      });
      return { tripId, attached: s.mediaIds.length };
    }
  }
}

/** Don't suggest this again (a photo suggestion comes back only for photos added later). */
export async function dismissSuggestion(scope: Scope, key: string): Promise<void> {
  if (!KEY.test(key)) throw badRequest("Unknown suggestion");
  const [kind, target] = key.split(":");
  // Only for things this family can see.
  if (kind.startsWith("trip-")) await loadReadable("trip", target, scope);
  if (kind === "visit-photos") await loadReadable("visit", target, scope);
  await query(
    `INSERT INTO suggestion_dismissals (family_id, key) VALUES ($1, $2)
     ON CONFLICT (family_id, key) DO UPDATE SET dismissed_at = now()`, [scope.familyId, key]);
}
