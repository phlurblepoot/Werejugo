import { pool, query } from "../../db/pool.js";
import { fieldsFromAsset, upsertAsset } from "../media/assets.js";
import { ImmichError, immich, type ImmichConn } from "./client.js";
import { familyConn } from "./provision.js";

/**
 * Keep a family's Werejugo library in step with its Immich account: new and
 * changed photos appear, trashed and deleted ones disappear — whether they
 * were added through Werejugo or in Immich directly.
 *
 * - Incremental (every few minutes): assets updated since the last run, and
 *   assets trashed since then.
 * - Full (nightly, and a family's first sync): every asset; references to
 *   assets no longer in the account are removed.
 */

export interface SyncResult {
  familyId: string;
  full: boolean;
  upserted: number;
  removed: number;
  skipped: boolean;
}

const PAGE = 1000;
const OVERLAP_MS = 2 * 60_000;
/**
 * What Werejugo shows: the timeline and the archive (not hidden Live Photo
 * halves, not Immich's locked folder), and nothing in Immich's trash. Immich's
 * structured search includes trashed assets unless the filter excludes them.
 */
const VISIBLE = { visibility: { in: ["timeline", "archive"] }, trashedAt: { eq: null } } as const;

async function* allPages(conn: ImmichConn, filter: Record<string, unknown>, withExif: boolean) {
  let cursor: string | undefined;
  for (;;) {
    const page = await immich.searchAssets(conn, { filter: filter as never, cursor, size: PAGE, withExif });
    yield page.items;
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

async function removeRefs(familyId: string, assetIds: string[]): Promise<number> {
  if (!assetIds.length) return 0;
  const r = await query("DELETE FROM media WHERE family_id = $1 AND immich_asset_id = ANY($2::uuid[])", [familyId, assetIds]);
  return r.rowCount ?? 0;
}

export async function syncFamily(familyId: string, opts: { full?: boolean } = {}): Promise<SyncResult> {
  // One sync per family at a time (the lock is released with its connection).
  const lock = await pool.connect();
  try {
    const got = (await lock.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [`immich-sync:${familyId}`])).rows[0].ok;
    if (!got) return { familyId, full: !!opts.full, upserted: 0, removed: 0, skipped: true };
    try {
      return await run(familyId, opts);
    } finally {
      await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [`immich-sync:${familyId}`]);
    }
  } finally {
    lock.release();
  }
}

async function run(familyId: string, opts: { full?: boolean }): Promise<SyncResult> {
  const conn = await familyConn(familyId);
  const state = (await query<{ sync_since: string | null }>("SELECT sync_since FROM family_immich WHERE family_id = $1", [familyId])).rows[0];
  if (!conn || !state) return { familyId, full: !!opts.full, upserted: 0, removed: 0, skipped: true };
  const full = !!opts.full || !state.sync_since;
  const startedAt = new Date();
  let upserted = 0;
  let removed = 0;

  try {
    if (full) {
      const seen: string[] = [];
      for await (const items of allPages(conn, { ...VISIBLE }, true)) {
        for (const a of items) {
          const f = fieldsFromAsset(a);
          if (!f) continue;
          if (await upsertAsset(familyId, a.id, f)) upserted++;
          seen.push(a.id);
        }
      }
      // Gone from Immich (or hidden there): drop the reference. References made
      // while this ran (a fresh upload) are kept.
      const r = await query(
        `DELETE FROM media WHERE family_id = $1 AND NOT (immich_asset_id = ANY($2::uuid[])) AND created_at < $3`,
        [familyId, seen, startedAt]);
      removed = r.rowCount ?? 0;
    } else {
      const since = state.sync_since!;
      for await (const items of allPages(conn, { ...VISIBLE, updatedAt: { gt: since } }, true)) {
        for (const a of items) {
          const f = fieldsFromAsset(a);
          if (f && (await upsertAsset(familyId, a.id, f))) upserted++;
        }
      }
      for await (const items of allPages(conn, { trashedAt: { gt: since } }, false)) {
        removed += await removeRefs(familyId, items.map((a) => a.id));
      }
    }
    await query(
      `UPDATE family_immich SET sync_since = $2, last_sync_at = now(), sync_error = NULL,
              last_full_sync_at = CASE WHEN $3 THEN now() ELSE last_full_sync_at END,
              asset_count = (SELECT count(*) FROM media WHERE family_id = $1)
        WHERE family_id = $1`,
      [familyId, new Date(startedAt.getTime() - OVERLAP_MS).toISOString(), full]);
    return { familyId, full, upserted, removed, skipped: false };
  } catch (e) {
    const message = e instanceof ImmichError || e instanceof Error ? e.message : "Sync failed";
    await query("UPDATE family_immich SET sync_error = $2, last_sync_at = now() WHERE family_id = $1", [familyId, message]);
    throw e;
  }
}

/** Families with a working Immich connection (the ones to sync). */
export async function connectedFamilies(): Promise<string[]> {
  return (await query<{ family_id: string }>(
    "SELECT family_id FROM family_immich WHERE api_key_sealed IS NOT NULL AND last_error IS NULL")).rows.map((r) => r.family_id);
}
