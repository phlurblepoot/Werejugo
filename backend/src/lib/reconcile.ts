import type { PoolClient } from "pg";
import { moveStored, documentDirFor } from "./storage.js";

/** Re-home a document file to match its current owner (person/trip/none). Call in a transaction. */
export async function reconcileDocument(client: PoolClient, docId: string): Promise<void> {
  const { rows } = await client.query<{
    family_id: string; rel_path: string | null; person_name: string | null; trip_name: string | null; trip_start: string | null;
  }>(
    `SELECT d.family_id, d.rel_path, p.display_name AS person_name, t.name AS trip_name,
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
    d.family_id,
    d.trip_name ? { tripName: d.trip_name, tripStart: d.trip_start } : null,
    d.person_name ? { personName: d.person_name } : null,
  );
  const currentDir = d.rel_path.slice(0, d.rel_path.lastIndexOf("/"));
  if (currentDir === dir) return;
  const newRel = await moveStored(d.rel_path, dir);
  await client.query("UPDATE documents SET rel_path = $1 WHERE id = $2", [newRel, docId]);
}
