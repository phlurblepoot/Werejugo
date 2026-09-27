import type pg from "pg";
import type { FastifyRequest } from "fastify";
import { query } from "../db/pool.js";
import type { Role } from "./auth.js";
import { badRequest, isUuid, notFound } from "./errors.js";

/**
 * Who is asking. Every read and write of family data is decided here, in one
 * place. An admin "viewing as" a family has that family's scope.
 *
 * Sharing (Phase 1.5): a trip is hosted by one family (trips.family_id) and
 * may have guest families (trip_members, role co-owner or contributor).
 * Content on a trip — places, itinerary items, photos, comments — keeps its
 * author family, and is visible to every family on the trip while its author
 * family is still on it. Packing, documents and the rest stay private.
 */
export interface Scope {
  userId: string;
  familyId: string;
  role: Role;
  isAdmin: boolean;
}

export function scopeOf(req: FastifyRequest): Scope {
  const u = req.user;
  return { userId: u.id, familyId: u.familyId, role: u.role, isAdmin: u.isAdmin };
}

export type TripRole = "host" | "coowner" | "contributor";

// ---- SQL building blocks. `trip`/`fam` are SQL expressions, `p` a placeholder like "$2". ----

/** `fam` hosts the trip or is a guest on it. */
export const familyOnTrip = (trip: string, fam: string) =>
  `(EXISTS (SELECT 1 FROM trips _h WHERE _h.id = ${trip} AND _h.family_id = ${fam})
    OR EXISTS (SELECT 1 FROM trip_members _m WHERE _m.trip_id = ${trip} AND _m.family_id = ${fam}))`;

/** `fam` hosts the trip or is a co-owner of it. */
const managesTrip = (trip: string, fam: string) =>
  `(EXISTS (SELECT 1 FROM trips _h WHERE _h.id = ${trip} AND _h.family_id = ${fam})
    OR EXISTS (SELECT 1 FROM trip_members _m WHERE _m.trip_id = ${trip} AND _m.family_id = ${fam} AND _m.role = 'coowner'))`;

/** The two families are on at least one trip together. */
const sharesATrip = (a: string, b: string) =>
  `EXISTS (SELECT 1 FROM trips _s
            WHERE (_s.family_id = ${a} OR EXISTS (SELECT 1 FROM trip_members _x WHERE _x.trip_id = _s.id AND _x.family_id = ${a}))
              AND (_s.family_id = ${b} OR EXISTS (SELECT 1 FROM trip_members _y WHERE _y.trip_id = _s.id AND _y.family_id = ${b})))`;

/** Trip content: mine, or on a trip I'm on whose author family is still on it. */
const tripContentReadable = (a: string, p: string) =>
  `(${a}.family_id = ${p} OR (${a}.trip_id IS NOT NULL AND ${familyOnTrip(`${a}.trip_id`, p)} AND ${familyOnTrip(`${a}.trip_id`, `${a}.family_id`)}))`;
/** Trip content I may change: mine, or anyone's on a trip I host or co-own. */
const tripContentEditable = (a: string, p: string) =>
  `(${a}.family_id = ${p} OR (${a}.trip_id IS NOT NULL AND ${managesTrip(`${a}.trip_id`, p)} AND ${familyOnTrip(`${a}.trip_id`, `${a}.family_id`)}))`;
const own = (a: string, p: string) => `${a}.family_id = ${p}`;

interface EntityDef {
  table: string;
  label: string;
  /** Joins needed by the conditions (child tables); they may use alias `a` for the entity. */
  join?: (a: string) => string;
  read: (a: string, p: string) => string;
  edit: (a: string, p: string) => string;
}

const ENTITIES = {
  trip: {
    table: "trips", label: "trip",
    read: (a, p) => `(${a}.family_id = ${p} OR EXISTS (SELECT 1 FROM trip_members _m WHERE _m.trip_id = ${a}.id AND _m.family_id = ${p}))`,
    edit: own, // details, sharing and members: the host only
  },
  visit: { table: "visits", label: "place", read: tripContentReadable, edit: tripContentEditable },
  itinerary_item: { table: "itinerary_items", label: "itinerary item", read: tripContentReadable, edit: tripContentEditable },
  media: { table: "media", label: "photo or video", read: tripContentReadable, edit: own },
  comment: {
    table: "comments", label: "comment",
    join: (a) => `JOIN visits _cv ON _cv.id = ${a}.visit_id`,
    read: (_a, p) => tripContentReadable("_cv", p),
    edit: (a, p) => `${a}.user_id IN (SELECT id FROM users WHERE family_id = ${p})`,
  },
  person: {
    table: "people", label: "person",
    // Another family's people are visible (name + picture) once we share a trip — to tag and link them.
    read: (a, p) => `(${a}.family_id = ${p} OR ${sharesATrip(`${a}.family_id`, p)})`,
    edit: own,
  },
  document: { table: "documents", label: "document", read: own, edit: own },
  theme: { table: "themes", label: "theme", read: (a, p) => `(${a}.family_id = ${p} OR ${a}.family_id IS NULL)`, edit: own },
  icon: { table: "icons", label: "icon", read: own, edit: own },
  blackout: { table: "blackout_periods", label: "blackout", read: own, edit: own },
  packing_list: { table: "packing_lists", label: "packing list", read: (a, p) => `(${a}.family_id = ${p} OR ${a}.is_builtin)`, edit: own },
  packing_item: {
    table: "packing_items", label: "packing item",
    join: (a) => `JOIN packing_lists _pl ON _pl.id = ${a}.list_id`,
    read: (_a, p) => `(_pl.family_id = ${p} OR _pl.is_builtin)`,
    edit: (_a, p) => `_pl.family_id = ${p}`,
  },
  link: { table: "links", label: "link", read: own, edit: own },
  share_link: { table: "share_links", label: "share link", read: own, edit: own },
  smart_album: { table: "smart_albums", label: "smart album", read: own, edit: own },
  user: { table: "users", label: "family member", read: own, edit: own },
} satisfies Record<string, EntityDef>;

export type EntityKind = keyof typeof ENTITIES;

const def = (kind: EntityKind): EntityDef => ENTITIES[kind];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** SQL condition: my family may see this row (alias `alias`, family id in placeholder `p`). */
export const readableWhere = (kind: EntityKind, alias: string, p: string): string => def(kind).read(alias, p);
/** SQL condition: my family may change this row. */
export const editableWhere = (kind: EntityKind, alias: string, p: string): string => def(kind).edit(alias, p);
/** SQL condition: the trip (expression) is one my family is on. */
export const onTripWhere = (trip: string, p: string): string => familyOnTrip(trip, p);

type Db = Pick<pg.PoolClient, "query">;
const run = <T extends pg.QueryResultRow>(db: Db | undefined, sql: string, params: unknown[]) =>
  db ? db.query<T>(sql, params) : query<T>(sql, params);

async function load<T extends pg.QueryResultRow>(
  kind: EntityKind, id: unknown, scope: Scope, mode: "read" | "edit",
  opts: { columns?: string; client?: Db; forUpdate?: boolean },
): Promise<T> {
  const d = def(kind);
  if (!isUuid(id)) throw notFound(`${cap(d.label)} not found`);
  const cond = mode === "read" ? d.read("t", "$2") : d.edit("t", "$2");
  const { rows } = await run<T>(
    opts.client,
    `SELECT ${opts.columns ?? "t.*"} FROM ${d.table} t ${d.join?.("t") ?? ""} WHERE t.id = $1 AND ${cond}${opts.forUpdate ? " FOR UPDATE OF t" : ""}`,
    [id, scope.familyId],
  );
  if (!rows[0]) throw notFound(`${cap(d.label)} not found`);
  return rows[0];
}

/** The row if this scope may see it, otherwise a 404 (never 403, so ids don't leak). */
export function loadReadable<T extends pg.QueryResultRow = pg.QueryResultRow>(
  kind: EntityKind, id: unknown, scope: Scope, opts: { columns?: string; client?: Db } = {},
): Promise<T> {
  return load<T>(kind, id, scope, "read", opts);
}

/** The row if this scope may change it (built-ins are read-only), otherwise a 404. */
export function loadEditable<T extends pg.QueryResultRow = pg.QueryResultRow>(
  kind: EntityKind, id: unknown, scope: Scope, opts: { columns?: string; client?: Db; forUpdate?: boolean } = {},
): Promise<T> {
  return load<T>(kind, id, scope, "edit", opts);
}

export type Refs = Partial<Record<EntityKind, string | readonly string[] | null | undefined>>;

/**
 * Every id about to be stored as a reference must be usable by this scope,
 * otherwise 400 "Unknown trip" etc. `use` (default): anything the family may
 * see — e.g. put a place on a shared trip, tag another family's person on it.
 * `own`: rows the family may change — e.g. its own photo as an avatar.
 */
export async function assertRefs(scope: Scope, refs: Refs, opts: { mode?: "use" | "own"; client?: Db } = {}): Promise<void> {
  for (const [kind, value] of Object.entries(refs) as Array<[EntityKind, Refs[EntityKind]]>) {
    if (value === null || value === undefined) continue;
    const ids = [...new Set(typeof value === "string" ? [value] : value)];
    if (!ids.length) continue;
    const d = def(kind);
    if (!ids.every(isUuid)) throw badRequest(`Unknown ${d.label}`);
    const cond = opts.mode === "own" ? d.edit("t", "$2") : d.read("t", "$2");
    const { rows } = await run<{ n: number }>(
      opts.client,
      `SELECT count(*)::int AS n FROM ${d.table} t ${d.join?.("t") ?? ""} WHERE t.id = ANY($1::uuid[]) AND ${cond}`,
      [ids, scope.familyId],
    );
    if (rows[0].n !== ids.length) throw badRequest(`Unknown ${d.label}`);
  }
}

/** My family's role on a trip, or null if it isn't on it. */
export async function tripRole(tripId: string, scope: Scope, client?: Db): Promise<TripRole | null> {
  const { rows } = await run<{ role: TripRole }>(
    client,
    `SELECT 'host' AS role FROM trips WHERE id = $1 AND family_id = $2
     UNION ALL SELECT role FROM trip_members WHERE trip_id = $1 AND family_id = $2`,
    [tripId, scope.familyId],
  );
  return rows[0]?.role ?? null;
}
