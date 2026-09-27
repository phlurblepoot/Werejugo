import type { PoolClient } from "pg";
import { query, tx } from "../db/pool.js";
import { parseRef, type CoreType, type EntityRef } from "./refs.js";
import { assertRefs, loadReadable, type Scope } from "./access.js";
import { badRequest, conflict } from "./errors.js";

// Canonical unordered allow-list. media↔trip is intentionally excluded:
// a photo's trip is the media.trip_id FK (Task 12), not a link.
const ALLOWED = new Set(["media|visit", "person|visit", "person|trip", "media|person"]);

function pairKey(a: CoreType, b: CoreType): string {
  return [a, b].sort().join("|");
}

export function isAllowedPair(a: CoreType, b: CoreType): boolean {
  return ALLOWED.has(pairKey(a, b));
}

export interface LinkDto {
  id: string;
  from: string;
  to: string;
  role: string;
}

/**
 * Create a link after validating types, that both ends are usable by this
 * family, and trip inheritance. Pairs are stored in one canonical direction
 * (by type name), so "photo → place" and "place → photo" are the same link.
 */
export async function createLink(scope: Scope, fromRaw: string, toRaw: string, role: string): Promise<LinkDto> {
  const a = parseRef(fromRaw);
  const b = parseRef(toRaw);
  if (!a || !b) throw badRequest("Invalid entity reference");
  if (!isAllowedPair(a.type, b.type)) throw badRequest("That link type is not allowed");
  await assertRefs(scope, { [a.type]: a.id });
  await assertRefs(scope, { [b.type]: b.id });
  const [from, to] = a.type <= b.type ? [a, b] : [b, a];
  const familyId = scope.familyId;
  const userId = scope.userId;

  // media↔visit: a photo inherits the visit's trip. Reject conflicts.
  const mediaVisit = pickMediaVisit(from, to);
  if (mediaVisit) {
    const problem = await applyTripInheritance(familyId, mediaVisit.mediaId, mediaVisit.visitId);
    if (problem) throw conflict(problem);
  }

  const { rows } = await query<{ id: string }>(
    `INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (family_id, from_type, from_id, to_type, to_id, role) DO UPDATE SET role = EXCLUDED.role
     RETURNING id`,
    [familyId, from.type, from.id, to.type, to.id, role, userId],
  );
  return { id: rows[0].id, from: fromRaw, to: toRaw, role };
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
    await query("UPDATE media SET trip_id = $1 WHERE id = $2 AND family_id = $3", [visitTrip, mediaId, familyId]);
  }
  return null;
}

export async function listLinks(scope: Scope, entityRaw: string): Promise<LinkDto[]> {
  const ref = parseRef(entityRaw);
  if (!ref) throw badRequest("Invalid entity reference");
  await loadReadable(ref.type, ref.id, scope);
  const familyId = scope.familyId;
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
