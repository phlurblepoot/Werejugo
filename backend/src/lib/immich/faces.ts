import { query } from "../../db/pool.js";
import { immich, type ImmichConn, type ImmichPerson } from "./client.js";
import { familyConnCached } from "./provision.js";

/**
 * Faces → people. Immich recognises people in a family's photos; the family
 * says which Werejugo person each one is (immich_people.person_id), and every
 * photo with that face is tagged: a media → person link with role 'face'.
 * Only 'face' links are ever added or removed here, never tags made by hand.
 */

const PAGE = 1000;
/** Counts read per run, at most (the rest next time). */
const COUNTS_PER_RUN = 200;
/** New photos whose faces are tagged by the frequent sync (the nightly one does everything). */
const RECENT_MS = 2 * 24 * 3600_000;

export interface FacesResult { people: number; tagged: number; untagged: number; skipped: boolean }

interface Row { id: string; immich_person_id: string; person_id: string | null; ignored: boolean; photo_count: number | null; immich_updated_at: string | null }

/** Every asset id with one of these people in it. */
async function assetsWith(conn: ImmichConn, immichPersonIds: string[]): Promise<string[]> {
  if (!immichPersonIds.length) return [];
  const ids: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await immich.searchAssets(conn, { filter: { personIds: { any: immichPersonIds }, trashedAt: { eq: null } }, cursor, size: PAGE });
    ids.push(...page.items.map((a) => a.id));
    if (!page.nextCursor) return ids;
    cursor = page.nextCursor;
  }
}

/**
 * Make the family's 'face' tags for one Werejugo person match the photos
 * that the Immich people mapped to them are in.
 */
export async function reconcilePerson(familyId: string, personId: string, conn?: ImmichConn): Promise<{ tagged: number; untagged: number }> {
  const c = conn ?? (await familyConnCached(familyId));
  if (!c) return { tagged: 0, untagged: 0 };
  const mapped = (await query<{ immich_person_id: string }>(
    "SELECT immich_person_id FROM immich_people WHERE family_id = $1 AND person_id = $2 AND NOT ignored", [familyId, personId])).rows.map((r) => r.immich_person_id);
  const assetIds = await assetsWith(c, mapped);
  const added = await query(
    `INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role)
     SELECT $1, 'media', m.id, 'person', $2, 'face' FROM media m WHERE m.family_id = $1 AND m.immich_asset_id = ANY($3::uuid[])
     ON CONFLICT DO NOTHING`, [familyId, personId, assetIds]);
  const removed = await query(
    `DELETE FROM links l WHERE l.family_id = $1 AND l.from_type = 'media' AND l.to_type = 'person' AND l.to_id = $2 AND l.role = 'face'
       AND NOT EXISTS (SELECT 1 FROM media m WHERE m.id = l.from_id AND m.immich_asset_id = ANY($3::uuid[]))`, [familyId, personId, assetIds]);
  await query("UPDATE immich_people SET reconciled_at = now() WHERE family_id = $1 AND person_id = $2", [familyId, personId]);
  return { tagged: added.rowCount ?? 0, untagged: removed.rowCount ?? 0 };
}

/**
 * Bring a family's faces up to date: Immich's people (added, renamed, hidden,
 * gone), their photo counts, and the tags. `full` reconciles every mapped
 * person (nightly); otherwise only people Immich changed, plus new photos.
 */
export async function syncFaces(familyId: string, opts: { full?: boolean } = {}): Promise<FacesResult> {
  const conn = await familyConnCached(familyId);
  if (!conn) return { people: 0, tagged: 0, untagged: 0, skipped: true };
  const listed: ImmichPerson[] = await immich.listPeople(conn);
  const known = new Map((await query<Row>(
    "SELECT id, immich_person_id, person_id, ignored, photo_count, immich_updated_at FROM immich_people WHERE family_id = $1", [familyId])).rows
    .map((r) => [r.immich_person_id, r]));

  const touched = new Set<string>(); // Werejugo people whose tags may have changed
  const needCount: string[] = [];
  for (const p of listed) {
    const prev = known.get(p.id);
    const updated = p.updatedAt ?? null;
    const changed = !prev || !prev.immich_updated_at || !updated || new Date(prev.immich_updated_at).getTime() !== new Date(updated).getTime();
    await query(
      `INSERT INTO immich_people (family_id, immich_person_id, name, birth_date, hidden_in_immich, immich_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (family_id, immich_person_id) DO UPDATE SET
         name = EXCLUDED.name, birth_date = EXCLUDED.birth_date, hidden_in_immich = EXCLUDED.hidden_in_immich,
         immich_updated_at = EXCLUDED.immich_updated_at`,
      [familyId, p.id, p.name ?? "", p.birthDate ?? null, p.isHidden, updated]);
    if (changed || prev?.photo_count == null) needCount.push(p.id);
    if (changed && prev?.person_id) touched.add(prev.person_id);
  }

  // People gone from Immich (merged or deleted there): their tags go too.
  const gone = (await query<{ person_id: string | null }>(
    "DELETE FROM immich_people WHERE family_id = $1 AND NOT (immich_person_id = ANY($2::uuid[])) RETURNING person_id",
    [familyId, listed.map((p) => p.id)])).rows;
  for (const g of gone) if (g.person_id) touched.add(g.person_id);

  for (const id of needCount.slice(0, COUNTS_PER_RUN)) {
    const count = await immich.personStats(conn, id).catch(() => null);
    if (count !== null) await query("UPDATE immich_people SET photo_count = $3 WHERE family_id = $1 AND immich_person_id = $2", [familyId, id, count]);
  }

  const people = opts.full
    ? (await query<{ person_id: string }>("SELECT DISTINCT person_id FROM immich_people WHERE family_id = $1 AND person_id IS NOT NULL", [familyId])).rows.map((r) => r.person_id)
    : [...touched];
  // Anyone who lost all their faces (gone above) still needs their tags removed.
  if (opts.full) {
    const orphaned = (await query<{ to_id: string }>(
      `SELECT DISTINCT to_id FROM links WHERE family_id = $1 AND role = 'face' AND to_type = 'person'
         AND to_id NOT IN (SELECT person_id FROM immich_people WHERE family_id = $1 AND person_id IS NOT NULL)`, [familyId])).rows;
    for (const o of orphaned) if (!people.includes(o.to_id)) people.push(o.to_id);
  }
  let tagged = 0;
  let untagged = 0;
  for (const personId of people) {
    const r = await reconcilePerson(familyId, personId, conn);
    tagged += r.tagged;
    untagged += r.untagged;
  }

  // New photos with a known face, between the nightly runs.
  if (!opts.full) tagged += await tagRecent(familyId, conn);
  return { people: listed.length, tagged, untagged, skipped: false };
}

/** Tag photos added lately that have a mapped face (add-only; the nightly run removes). */
async function tagRecent(familyId: string, conn: ImmichConn): Promise<number> {
  const mapped = (await query<{ immich_person_id: string; person_id: string }>(
    "SELECT immich_person_id, person_id FROM immich_people WHERE family_id = $1 AND person_id IS NOT NULL AND NOT ignored", [familyId])).rows;
  if (!mapped.length) return 0;
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  // Most runs have no new photos at all: one cheap look before a search per person.
  const any = await immich.searchAssets(conn, { filter: { createdAt: { gt: since }, trashedAt: { eq: null } }, size: 1 });
  if (!any.items.length) return 0;
  const toPerson = new Map(mapped.map((m) => [m.immich_person_id, m.person_id]));
  let added = 0;
  for (const [immichId, personId] of toPerson) {
    const page = await immich.searchAssets(conn, {
      filter: { personIds: { any: [immichId] }, createdAt: { gt: since }, trashedAt: { eq: null } }, size: PAGE,
    });
    if (!page.items.length) continue;
    const r = await query(
      `INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role)
       SELECT $1, 'media', m.id, 'person', $2, 'face' FROM media m WHERE m.family_id = $1 AND m.immich_asset_id = ANY($3::uuid[])
       ON CONFLICT DO NOTHING`, [familyId, personId, page.items.map((a) => a.id)]);
    added += r.rowCount ?? 0;
  }
  return added;
}
