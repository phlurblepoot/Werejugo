import { query } from "../db/pool.js";
import type pg from "pg";

/**
 * Every application table, in FK-safe INSERT order (parents before children).
 * Reference tables (airports/ports/spatial_ref_sys) and schema_migrations are
 * intentionally excluded — they are recreated by migrations/seed, not restored.
 */
export const BACKUP_TABLES = [
  "families", "users", "themes", "trips", "map_sets", "visits", "media", "people",
  "icons", "documents", "links", "map_set_visits", "visit_waypoints", "comments",
  "itinerary_items", "packing_lists", "packing_items", "blackout_periods", "share_links",
] as const;

/** Dump every table to a `{ [table]: rows[] }` object. Geometry is encoded as
 *  GeoJSON automatically by to_jsonb and round-trips via jsonb_populate_recordset. */
export async function dumpDatabase(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    const { rows } = await query<{ rows: unknown[] }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows FROM "${table}" t`);
    out[table] = rows[0].rows;
  }
  return out;
}

/** Wipe all application tables and reinsert the dump, in FK-safe order, atomically. */
export async function restoreDatabase(client: pg.PoolClient, db: Record<string, unknown[]>): Promise<Record<string, number>> {
  const tableList = BACKUP_TABLES.map((t) => `"${t}"`).join(", ");
  await client.query(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`);
  const counts: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    const rows = db[table] ?? [];
    if (rows.length > 0) {
      await client.query(
        `INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`,
        [JSON.stringify(rows)]);
    }
    counts[table] = rows.length;
  }
  return counts;
}
