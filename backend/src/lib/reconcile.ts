import type { PoolClient } from "pg";
import { mediaDirFor, moveStored } from "./storage.js";

/** Re-home a media file to match its current trip_id. Call inside a transaction. */
export async function reconcileMediaTrip(client: PoolClient, mediaId: string): Promise<void> {
  const { rows } = await client.query<{
    rel_path: string; thumb_rel_path: string | null; taken_at: string | null;
    trip_name: string | null; trip_start: string | null;
  }>(
    `SELECT m.rel_path, m.thumb_rel_path, m.taken_at, t.name AS trip_name,
            to_char(t.start_date, 'YYYY-MM-DD') AS trip_start
     FROM media m LEFT JOIN trips t ON t.id = m.trip_id
     WHERE m.id = $1`,
    [mediaId],
  );
  const m = rows[0];
  if (!m) return;
  const trip = m.trip_name ? { name: m.trip_name, startDate: m.trip_start } : null;
  const takenAt = m.taken_at ? new Date(m.taken_at) : null;
  const destDir = mediaDirFor(trip, takenAt);

  const currentDir = m.rel_path.slice(0, m.rel_path.lastIndexOf("/"));
  if (currentDir === destDir) return;

  const newRel = await moveStored(m.rel_path, destDir);
  let newThumb: string | null = null;
  if (m.thumb_rel_path) newThumb = await moveStored(m.thumb_rel_path, destDir);
  await client.query("UPDATE media SET rel_path = $1, thumb_rel_path = $2 WHERE id = $3", [
    newRel, newThumb, mediaId,
  ]);
}
