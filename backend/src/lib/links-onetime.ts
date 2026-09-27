import { query } from "../db/pool.js";
import { expiresInDays, hashToken, newToken } from "./tokens.js";
import type { Role } from "./auth.js";

export interface IssuedLink {
  id: string;
  /** The raw token — returned once, never stored. */
  token: string;
  /** App path to share; the client prefixes its own origin. */
  path: string;
  expiresAt: string;
}

export async function createInvite(opts: {
  kind: "family" | "member";
  familyId?: string | null;
  role?: Role;
  note?: string;
  createdBy: string;
  days?: number;
}): Promise<IssuedLink> {
  const token = newToken();
  const { rows } = await query<{ id: string; expires_at: Date }>(
    `INSERT INTO invites (kind, token_hash, family_id, role, note, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, expires_at`,
    [opts.kind, hashToken(token), opts.familyId ?? null, opts.role ?? (opts.kind === "family" ? "owner" : "member"),
     opts.note ?? "", opts.createdBy, expiresInDays(opts.days ?? 7)],
  );
  return { id: rows[0].id, token, path: `/invite/${token}`, expiresAt: rows[0].expires_at.toISOString() };
}

export interface InviteRow {
  id: string;
  kind: "family" | "member";
  family_id: string | null;
  family_name: string | null;
  role: Role;
  expires_at: Date;
  created_by_name: string | null;
}

/** An invite that can still be used (not expired, used or revoked), or null. */
export async function findUsableInvite(token: string): Promise<InviteRow | null> {
  const { rows } = await query<InviteRow>(
    `SELECT i.id, i.kind, i.family_id, f.name AS family_name, i.role, i.expires_at, u.display_name AS created_by_name
       FROM invites i
       LEFT JOIN families f ON f.id = i.family_id
       LEFT JOIN users u ON u.id = i.created_by
      WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function createResetLink(userId: string, createdBy: string, days = 3): Promise<IssuedLink> {
  const token = newToken();
  // A new link replaces any earlier unused ones for the same person.
  await query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
  const { rows } = await query<{ id: string; expires_at: Date }>(
    `INSERT INTO password_resets (user_id, token_hash, created_by, expires_at) VALUES ($1, $2, $3, $4) RETURNING id, expires_at`,
    [userId, hashToken(token), createdBy, expiresInDays(days)],
  );
  return { id: rows[0].id, token, path: `/reset/${token}`, expiresAt: rows[0].expires_at.toISOString() };
}
