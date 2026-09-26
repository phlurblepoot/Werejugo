import type pg from "pg";
import { query } from "../db/pool.js";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  familyId?: string | null;
  target?: string;
  details?: Record<string, unknown>;
}

/** Record who did what. The actor's name is copied so the log survives deletes. */
export async function audit(entry: AuditEntry, client?: pg.PoolClient): Promise<void> {
  const sql = `INSERT INTO audit_log (actor_user_id, actor_name, action, family_id, target, details)
               VALUES ($1, COALESCE((SELECT display_name FROM users WHERE id = $1), ''), $2, $3, $4, $5)`;
  const params = [entry.actorId, entry.action, entry.familyId ?? null, entry.target ?? "", JSON.stringify(entry.details ?? {})];
  if (client) await client.query(sql, params);
  else await query(sql, params);
}
