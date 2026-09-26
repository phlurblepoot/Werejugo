import type pg from "pg";
import type { FastifyRequest } from "fastify";
import { query } from "../db/pool.js";
import type { Role } from "./auth.js";
import { badRequest, isUuid, notFound } from "./errors.js";

/**
 * Who is asking. Every read and write of family data is decided from this —
 * in one place, so shared trips (Phase 1.5) widen one rule instead of every
 * route. An admin "viewing as" a family has that family's scope.
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

interface EntityDef {
  table: string;
  label: string;
  /** Joins needed to find the row's family (child tables). */
  join?: string;
  /** SQL for the row's family id (alias `t` is the entity's table). */
  family?: string;
  /** Rows every family may read and reference, but not change (built-ins). */
  shared?: string;
}

const ENTITIES = {
  trip: { table: "trips", label: "trip" },
  visit: { table: "visits", label: "place" },
  person: { table: "people", label: "person" },
  media: { table: "media", label: "photo or video" },
  document: { table: "documents", label: "document" },
  theme: { table: "themes", label: "theme", shared: "t.family_id IS NULL" },
  icon: { table: "icons", label: "icon" },
  map_set: { table: "map_sets", label: "map" },
  itinerary_item: { table: "itinerary_items", label: "itinerary item" },
  blackout: { table: "blackout_periods", label: "blackout" },
  packing_list: { table: "packing_lists", label: "packing list", shared: "t.is_builtin" },
  packing_item: { table: "packing_items", label: "packing item", join: "JOIN packing_lists p ON p.id = t.list_id", family: "p.family_id" },
  comment: { table: "comments", label: "comment", join: "JOIN visits v ON v.id = t.visit_id", family: "v.family_id" },
  link: { table: "links", label: "link" },
  share_link: { table: "share_links", label: "share link" },
} satisfies Record<string, EntityDef>;

export type EntityKind = keyof typeof ENTITIES;

const def = (kind: EntityKind): EntityDef => ENTITIES[kind];
const familyOf = (d: EntityDef) => d.family ?? "t.family_id";
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

type Db = Pick<pg.PoolClient, "query">;
const run = <T extends pg.QueryResultRow>(db: Db | undefined, sql: string, params: unknown[]) =>
  db ? db.query<T>(sql, params) : query<T>(sql, params);

/**
 * SQL condition: the row (alias `alias`) belongs to the scope's family.
 * `param` is the placeholder number that will hold `scope.familyId`.
 */
export function familyWhere(alias: string, param: number): string {
  return `${alias}.family_id = $${param}`;
}

async function load<T extends pg.QueryResultRow>(
  kind: EntityKind, id: unknown, scope: Scope, includeShared: boolean,
  opts: { columns?: string; client?: Db; forUpdate?: boolean },
): Promise<T> {
  const d = def(kind);
  if (!isUuid(id)) throw notFound(`${cap(d.label)} not found`);
  const mine = `${familyOf(d)} = $2`;
  const cond = includeShared && d.shared ? `(${mine} OR ${d.shared})` : mine;
  const { rows } = await run<T>(
    opts.client,
    `SELECT ${opts.columns ?? "t.*"} FROM ${d.table} t ${d.join ?? ""} WHERE t.id = $1 AND ${cond}${opts.forUpdate ? " FOR UPDATE OF t" : ""}`,
    [id, scope.familyId],
  );
  if (!rows[0]) throw notFound(`${cap(d.label)} not found`);
  return rows[0];
}

/** The row if this scope may see it, otherwise a 404 (never 403, so ids don't leak). */
export function loadReadable<T extends pg.QueryResultRow = pg.QueryResultRow>(
  kind: EntityKind, id: unknown, scope: Scope, opts: { columns?: string; client?: Db } = {},
): Promise<T> {
  return load<T>(kind, id, scope, true, opts);
}

/** The row if this scope may change it (built-ins are read-only), otherwise a 404. */
export function loadEditable<T extends pg.QueryResultRow = pg.QueryResultRow>(
  kind: EntityKind, id: unknown, scope: Scope, opts: { columns?: string; client?: Db; forUpdate?: boolean } = {},
): Promise<T> {
  return load<T>(kind, id, scope, false, opts);
}

export type Refs = Partial<Record<EntityKind, string | readonly string[] | null | undefined>>;

/**
 * Every id about to be stored as a reference must be something this scope may
 * use (its family's rows, or built-ins). Otherwise 400 "Unknown trip" etc.
 */
export async function assertRefs(scope: Scope, refs: Refs, client?: Db): Promise<void> {
  for (const [kind, value] of Object.entries(refs) as Array<[EntityKind, Refs[EntityKind]]>) {
    if (value === null || value === undefined) continue;
    const ids = [...new Set(typeof value === "string" ? [value] : value)];
    if (!ids.length) continue;
    const d = def(kind);
    if (!ids.every(isUuid)) throw badRequest(`Unknown ${d.label}`);
    const mine = `${familyOf(d)} = $2`;
    const cond = d.shared ? `(${mine} OR ${d.shared})` : mine;
    const { rows } = await run<{ n: number }>(
      client,
      `SELECT count(*)::int AS n FROM ${d.table} t ${d.join ?? ""} WHERE t.id = ANY($1::uuid[]) AND ${cond}`,
      [ids, scope.familyId],
    );
    if (rows[0].n !== ids.length) throw badRequest(`Unknown ${d.label}`);
  }
}
