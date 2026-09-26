import type pg from "pg";
import { query } from "../db/pool.js";

export type ActivityKind =
  | "visit.added" | "itinerary.added" | "photo.added" | "comment.added"
  | "member.joined" | "member.left" | "member.removed" | "member.role_changed";

type Db = Pick<pg.PoolClient, "query">;

/** Record something that happened on a trip (the trip's activity feed). Never fails the request. */
export async function recordActivity(
  e: { tripId: string | null | undefined; familyId: string; userId: string | null; kind: ActivityKind; targetType?: string; targetId?: string | null; summary?: string },
  client?: Db,
): Promise<void> {
  if (!e.tripId) return;
  const sql = `INSERT INTO activity (trip_id, family_id, user_id, kind, target_type, target_id, summary)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`;
  const params = [e.tripId, e.familyId, e.userId, e.kind, e.targetType ?? "", e.targetId ?? null, (e.summary ?? "").slice(0, 300)];
  try {
    if (client) await client.query(sql, params);
    else await query(sql, params);
  } catch (err) {
    // Inside a transaction a failure would poison it; outside, the change itself already happened.
    if (client) throw err;
  }
}
