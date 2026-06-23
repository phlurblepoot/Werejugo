import type { PoolClient } from "pg";
import { query, tx } from "../db/pool.js";
import { parseRef, TABLE_FOR, type CoreType, type EntityRef } from "./refs.js";
import { reconcileMediaTrip } from "./reconcile.js";

// Canonical unordered allow-list. media↔trip is intentionally excluded:
// a photo's trip is the media.trip_id FK (Task 12), not a link.
const ALLOWED = new Set(["media|visit", "person|visit", "person|trip", "media|person"]);

function pairKey(a: CoreType, b: CoreType): string {
  return [a, b].sort().join("|");
}

export function isAllowedPair(a: CoreType, b: CoreType): boolean {
  return ALLOWED.has(pairKey(a, b));
}

async function belongsToFamily(familyId: string, ref: EntityRef): Promise<boolean> {
  const { rowCount } = await query(
    `SELECT 1 FROM ${TABLE_FOR[ref.type]} WHERE id = $1 AND family_id = $2`,
    [ref.id, familyId],
  );
  return Boolean(rowCount);
}

export interface LinkDto {
  id: string;
  from: string;
  to: string;
  role: string;
}

export type LinkResult =
  | { ok: true; link: LinkDto }
  | { ok: false; code: number; error: string };

/** Create a link after validating types, family ownership, and trip inheritance. */
export async function createLink(
  familyId: string,
  userId: string,
  fromRaw: string,
  toRaw: string,
  role: string,
): Promise<LinkResult> {
  const from = parseRef(fromRaw);
  const to = parseRef(toRaw);
  if (!from || !to) return { ok: false, code: 400, error: "Invalid entity reference" };
  if (!isAllowedPair(from.type, to.type)) {
    return { ok: false, code: 400, error: "That link type is not allowed" };
  }
  if (!(await belongsToFamily(familyId, from)) || !(await belongsToFamily(familyId, to))) {
    return { ok: false, code: 404, error: "Entity not found" };
  }

  // media↔visit: a photo inherits the visit's trip (move-on-link). Reject conflicts.
  const mediaVisit = pickMediaVisit(from, to);
  if (mediaVisit) {
    const conflict = await applyTripInheritance(familyId, mediaVisit.mediaId, mediaVisit.visitId);
    if (conflict) return { ok: false, code: 409, error: conflict };
  }

  const { rows } = await query<{ id: string }>(
    `INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (family_id, from_type, from_id, to_type, to_id, role) DO UPDATE SET role = EXCLUDED.role
     RETURNING id`,
    [familyId, from.type, from.id, to.type, to.id, role, userId],
  );
  return { ok: true, link: { id: rows[0].id, from: fromRaw, to: toRaw, role } };
}

function pickMediaVisit(a: EntityRef, b: EntityRef): { mediaId: string; visitId: string } | null {
  if (a.type === "media" && b.type === "visit") return { mediaId: a.id, visitId: b.id };
  if (a.type === "visit" && b.type === "media") return { mediaId: b.id, visitId: a.id };
  return null;
}

/** Set media.trip_id from the visit's trip if unset; return an error string on conflict. */
async function applyTripInheritance(
  familyId: string,
  mediaId: string,
  visitId: string,
): Promise<string | null> {
  const v = await query<{ trip_id: string | null }>(
    "SELECT trip_id FROM visits WHERE id = $1 AND family_id = $2",
    [visitId, familyId],
  );
  const visitTrip = v.rows[0]?.trip_id ?? null;
  if (!visitTrip) return null;

  const m = await query<{ trip_id: string | null }>(
    "SELECT trip_id FROM media WHERE id = $1 AND family_id = $2",
    [mediaId, familyId],
  );
  const mediaTrip = m.rows[0]?.trip_id ?? null;
  if (mediaTrip && mediaTrip !== visitTrip) {
    return "This photo already belongs to a different trip";
  }
  if (!mediaTrip) {
    await tx(async (client: PoolClient) => {
      await client.query("UPDATE media SET trip_id = $1 WHERE id = $2", [visitTrip, mediaId]);
      await reconcileMediaTrip(client, mediaId);
    });
  }
  return null;
}

export async function listLinks(familyId: string, entityRaw: string): Promise<LinkDto[] | null> {
  const ref = parseRef(entityRaw);
  if (!ref) return null;
  const { rows } = await query<{ id: string; from_type: string; from_id: string; to_type: string; to_id: string; role: string }>(
    `SELECT id, from_type, from_id, to_type, to_id, role FROM links
     WHERE family_id = $1 AND ((from_type = $2 AND from_id = $3) OR (to_type = $2 AND to_id = $3))
     ORDER BY created_at ASC`,
    [familyId, ref.type, ref.id],
  );
  return rows.map((r) => ({
    id: r.id,
    from: `${r.from_type}:${r.from_id}`,
    to: `${r.to_type}:${r.to_id}`,
    role: r.role,
  }));
}

export async function deleteLink(familyId: string, id: string): Promise<boolean> {
  const res = await query("DELETE FROM links WHERE id = $1 AND family_id = $2", [id, familyId]);
  return Boolean(res.rowCount);
}
