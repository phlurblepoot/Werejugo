import { query } from "../../db/pool.js";
import { immich, type ImmichAlbum, type ImmichConn } from "./client.js";
import { familyConnCached } from "./provision.js";

/**
 * Trips ↔ Immich albums. Every trip a family is on is also an album in its
 * Immich account, holding the family's photos of the trip (media.trip_id).
 * Each pass merges both sides' changes against the album's contents at the
 * last pass (trip_albums.synced_assets):
 *
 * - added in Werejugo → added to the album; removed in Werejugo → removed;
 * - added to the album in Immich → put in the trip; removed → taken out.
 *
 * A photo changed on both sides follows Werejugo. An album deleted in Immich
 * is made again (not taken as "empty the trip"); album names follow the trip.
 * Triggers (migration 0009) mark an album dirty when Werejugo changes it.
 */

export interface AlbumsResult {
  albums: number;
  /** Albums looked at in detail this pass. */
  reconciled: number;
  created: number;
  /** Photos added to / removed from albums in Immich. */
  added: number;
  removed: number;
  /** Photos put in / taken out of trips because of a change in Immich. */
  joined: number;
  left: number;
  deleted: number;
  errors: number;
  skipped: boolean;
}

const PAGE = 1000;
/** Assets an album is made with; the rest are added after. */
const CREATE_WITH = 500;
export const ALBUM_DESCRIPTION = "Kept in step with the trip in Werejugo: photos added to or removed from this album are added to or removed from the trip.";

interface Row {
  id: string; trip_id: string | null; immich_album_id: string | null; name: string; synced_assets: string[];
  immich_updated_at: string | null; immich_asset_count: number | null; synced_at: string | null;
  trip_name: string | null; on_trip: boolean;
}

const EMPTY = (): AlbumsResult => ({ albums: 0, reconciled: 0, created: 0, added: 0, removed: 0, joined: 0, left: 0, deleted: 0, errors: 0, skipped: false });
const sameTime = (a: string | null, b: string | null) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();
const minus = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => !b.has(x)));

/** The album's photos in Immich (not trashed, not hidden Live Photo halves). */
async function albumAssets(conn: ImmichConn, albumId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await immich.searchAssets(conn, { filter: { albumIds: { any: [albumId] }, trashedAt: { eq: null } }, cursor, size: PAGE });
    for (const a of page.items) if (a.visibility !== "hidden" && a.visibility !== "locked") ids.add(a.id);
    if (!page.nextCursor) return ids;
    cursor = page.nextCursor;
  }
}

// One pass per family at a time (the backend is one process); a pass asked for
// while one runs waits for it, so nothing changed meanwhile is missed.
const tails = new Map<string, Promise<unknown>>();
function exclusive<T>(familyId: string, fn: () => Promise<T>): Promise<T> {
  const next = (tails.get(familyId) ?? Promise.resolve()).catch(() => {}).then(fn);
  tails.set(familyId, next);
  next.catch(() => {}).finally(() => { if (tails.get(familyId) === next) tails.delete(familyId); });
  return next;
}

/** Bring a family's trip albums up to date. `full` looks at every album, changed or not (nightly). */
export function syncAlbums(familyId: string, opts: { full?: boolean; onStart?: () => void } = {}): Promise<AlbumsResult> {
  return exclusive(familyId, () => {
    opts.onStart?.();
    return pass(familyId, !!opts.full);
  });
}

async function pass(familyId: string, full: boolean): Promise<AlbumsResult> {
  const r = EMPTY();
  const conn = await familyConnCached(familyId);
  if (!conn) return { ...r, skipped: true };

  // Every trip the family is on gets an album, empty or not, so photos can be put in a trip from Immich.
  await query(
    `INSERT INTO trip_albums (family_id, trip_id)
     SELECT $1, t.id FROM trips t
      WHERE t.family_id = $1 OR EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.family_id = $1)
     ON CONFLICT (family_id, trip_id) DO NOTHING`, [familyId]);
  const rows = (await query<Row>(
    `SELECT ta.id, ta.trip_id, ta.immich_album_id, ta.name, ta.synced_assets, ta.immich_updated_at, ta.immich_asset_count, ta.synced_at,
            t.name AS trip_name,
            (t.family_id = $1 OR EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.family_id = $1)) AS on_trip
       FROM trip_albums ta LEFT JOIN trips t ON t.id = ta.trip_id
      WHERE ta.family_id = $1`, [familyId])).rows;
  const albums = new Map((await immich.listAlbums(conn)).map((a) => [a.id, a]));

  for (const row of rows) {
    try {
      if (!row.trip_id) {
        // The trip was deleted: so is its album (its photos stay in Immich).
        if (row.immich_album_id && albums.has(row.immich_album_id)) await immich.deleteAlbum(conn, row.immich_album_id);
        await query("DELETE FROM trip_albums WHERE id = $1", [row.id]);
        r.deleted++;
        continue;
      }
      // A family that left the trip keeps its album, unsynced, until it's back on the trip.
      if (!row.on_trip) continue;
      r.albums++;
      const album = row.immich_album_id ? albums.get(row.immich_album_id) : undefined;
      const changedInImmich = !!album && (album.assetCount !== row.immich_asset_count || !sameTime(album.updatedAt, row.immich_updated_at));
      // (dirty is read again: an earlier album in this pass may have moved a photo out of this one.)
      if (!full && album && !changedInImmich
        && !(await query<{ dirty: boolean }>("SELECT dirty FROM trip_albums WHERE id = $1", [row.id])).rows[0]?.dirty) continue;
      await reconcile(familyId, conn, row, album, r);
      r.reconciled++;
    } catch (err) {
      r.errors++;
      await query("UPDATE trip_albums SET last_error = $2 WHERE id = $1", [row.id, err instanceof Error ? err.message : String(err)]);
    }
  }
  return r;
}

async function reconcile(familyId: string, conn: ImmichConn, row: Row, album: ImmichAlbum | undefined, r: AlbumsResult): Promise<void> {
  const tripId = row.trip_id!;
  const name = row.trip_name ?? "";
  // Cleared first: a change made while this pass runs marks it again for the next.
  await query("UPDATE trip_albums SET dirty = false WHERE id = $1", [row.id]);
  const inTrip = async () => new Set((await query<{ a: string }>(
    "SELECT immich_asset_id AS a FROM media WHERE family_id = $1 AND trip_id = $2", [familyId, tripId])).rows.map((x) => x.a));
  const W = await inTrip();

  let albumId: string;
  let finalAlbum: Set<string>;
  let touched = false;
  if (!album) {
    // New, or deleted in Immich: made (again) with the trip's photos.
    const ids = [...W];
    const made = await immich.createAlbum(conn, name, ALBUM_DESCRIPTION, ids.slice(0, CREATE_WITH));
    if (ids.length > CREATE_WITH) await immich.addToAlbum(conn, made.id, ids.slice(CREATE_WITH));
    albumId = made.id;
    finalAlbum = W;
    r.created++;
    r.added += ids.length;
    touched = true;
  } else {
    albumId = album.id;
    const I = await albumAssets(conn, albumId);
    const B = new Set(row.synced_assets);
    const addedHere = minus(W, B);
    const removedHere = minus(B, W);
    // Werejugo → Immich.
    const toAdd = [...minus(addedHere, I)];
    const toRemove = [...removedHere].filter((a) => I.has(a));
    // Immich → Werejugo; a photo changed on both sides follows Werejugo.
    let join = [...minus(I, B)].filter((a) => !removedHere.has(a) && !W.has(a));
    const leave = [...minus(B, I)].filter((a) => W.has(a) && !addedHere.has(a));
    if (join.length && row.synced_at) {
      // Put in another trip in Werejugo since this album's last pass, while added here in
      // Immich: Werejugo's change wins, and the photo comes back out of this album.
      const pending = new Set((await query<{ a: string }>(
        `SELECT immich_asset_id AS a FROM media
          WHERE family_id = $1 AND immich_asset_id = ANY($2::uuid[]) AND trip_id <> $3 AND trip_changed_at > $4`,
        [familyId, join, tripId, row.synced_at])).rows.map((x) => x.a));
      join = join.filter((a) => !pending.has(a));
      toRemove.push(...pending);
    }

    if (toAdd.length) await immich.addToAlbum(conn, albumId, toAdd);
    if (toRemove.length) await immich.removeFromAlbum(conn, albumId, toRemove);
    touched = !!(toAdd.length || toRemove.length);
    r.added += toAdd.length;
    r.removed += toRemove.length;
    if (join.length) {
      const moved = await query(
        "UPDATE media SET trip_id = $2 WHERE family_id = $1 AND immich_asset_id = ANY($3::uuid[])", [familyId, tripId, join]);
      r.joined += moved.rowCount ?? 0;
    }
    if (leave.length) {
      const out = await query(
        "UPDATE media SET trip_id = NULL WHERE family_id = $1 AND trip_id = $2 AND immich_asset_id = ANY($3::uuid[])", [familyId, tripId, leave]);
      r.left += out.rowCount ?? 0;
    }
    finalAlbum = new Set([...I, ...toAdd].filter((a) => !toRemove.includes(a)));
  }
  if (album && album.albumName !== name) {
    await immich.renameAlbum(conn, albumId, name);
    touched = true;
  }

  // The new base: what's in both the album and the trip now. A photo in the
  // album that Werejugo doesn't have yet stays out, and joins once it does.
  const now = await inTrip();
  const base = [...finalAlbum].filter((a) => now.has(a));
  const latest = touched ? await immich.getAlbum(conn, albumId) : album!;
  await query(
    `UPDATE trip_albums SET immich_album_id = $2, name = $3, synced_assets = $4::uuid[], immich_updated_at = $5,
            immich_asset_count = $6, synced_at = now(), last_error = NULL WHERE id = $1`,
    [row.id, albumId, name, base, latest.updatedAt, latest.assetCount]);
}
