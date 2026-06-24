import type { PoolClient } from "pg";
import { mediaDirFor, moveStored, documentDirFor } from "./storage.js";

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

/** Re-home a document file to match its current owner (person/trip/none). Call in a transaction. */
export async function reconcileDocument(client: PoolClient, docId: string): Promise<void> {
  const { rows } = await client.query<{
    rel_path: string | null; person_name: string | null; trip_name: string | null; trip_start: string | null;
  }>(
    `SELECT d.rel_path, p.display_name AS person_name, t.name AS trip_name,
            to_char(t.start_date, 'YYYY-MM-DD') AS trip_start
     FROM documents d
     LEFT JOIN people p ON p.id = d.owner_person_id
     LEFT JOIN trips t ON t.id = d.owner_trip_id
     WHERE d.id = $1`,
    [docId],
  );
  const d = rows[0];
  if (!d || !d.rel_path) return; // nothing to move
  const dir = documentDirFor(
    d.trip_name ? { tripName: d.trip_name, tripStart: d.trip_start } : null,
    d.person_name ? { personName: d.person_name } : null,
  );
  const currentDir = d.rel_path.slice(0, d.rel_path.lastIndexOf("/"));
  if (currentDir === dir) return;
  const newRel = await moveStored(d.rel_path, dir);
  await client.query("UPDATE documents SET rel_path = $1 WHERE id = $2", [newRel, docId]);
}
