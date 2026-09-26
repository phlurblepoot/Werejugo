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
  "invites", "password_resets", "audit_log",
  "trip_members", "trip_invites", "person_links", "activity",
] as const;

/** Tables with a serial id whose sequence must follow the restored rows. */
const SERIAL_TABLES = ["audit_log", "activity"] as const;

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
    const rows = (db[table] ?? []) as Array<Record<string, unknown>>;
    if (rows.length > 0) {
      // Only the columns the archive has: a backup from an older version lacks
      // newer columns, which then get their defaults instead of NULL.
      const { rows: cols } = await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [table]);
      const inArchive = new Set(rows.flatMap((r) => Object.keys(r)));
      const list = cols.map((c) => c.column_name).filter((c) => inArchive.has(c)).map((c) => `"${c}"`).join(", ");
      await client.query(
        `INSERT INTO "${table}" (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`,
        [JSON.stringify(rows)]);
    }
    counts[table] = rows.length;
  }
  for (const table of SERIAL_TABLES) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM "${table}"`);
  }
  // Archives from before server admins existed: the oldest family's first owner
  // becomes the admin, so the server is never left without one.
  await client.query(`
    UPDATE users SET is_admin = true
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE is_admin)
       AND id = (SELECT u.id FROM users u JOIN families f ON f.id = u.family_id
                  WHERE u.role = 'owner' ORDER BY f.created_at, u.created_at LIMIT 1)`);
  return counts;
}
