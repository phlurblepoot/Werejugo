import { query } from "../../db/pool.js";
import { immich, smartSearchOff, type ImmichConn } from "../immich/client.js";
import { HttpError } from "../errors.js";
import { MEDIA_COLUMNS, mediaDto, type MediaDtoRow } from "./dto.js";
import { filterSql, SORT_TS, type MediaFilter } from "./filters.js";

/**
 * Smart search (Immich's CLIP) within a family's library, with Werejugo's own
 * filters on top: Immich ranks its assets, and Werejugo keeps those in the
 * family's library that pass the filters (hidden photos are left out), in
 * Immich's order.
 */

export const SMART_SEARCH_OFF = "Smart search needs Immich's machine learning, which is turned off on your Immich server.";
const PAGE = 100;

export async function smartSearchLibrary(
  conn: ImmichConn, familyId: string, text: string, f: MediaFilter, page = 1, opts: { ownOnly?: boolean } = {},
): Promise<{ items: ReturnType<typeof mediaDto>[]; nextPage: number | null }> {
  let found;
  try {
    found = await immich.smartSearch(conn, {
      query: text, page, size: PAGE,
      // What Immich can narrow itself; the rest is Werejugo's.
      type: f.kind === "video" ? "VIDEO" : f.kind === "image" ? "IMAGE" : undefined,
      takenAfter: f.from ? `${f.from}T00:00:00.000Z` : undefined,
      takenBefore: f.to ? `${f.to}T23:59:59.999Z` : undefined,
    });
  } catch (e) {
    if (smartSearchOff(e)) throw new HttpError(409, SMART_SEARCH_OFF);
    throw e;
  }
  const ids = found.items.map((a) => a.id);
  if (!ids.length) return { items: [], nextPage: found.nextPage };
  const { where, params, add } = filterSql(f, familyId);
  const idsParam = add(ids);
  if (opts.ownOnly) where.push("m.family_id = $1");
  const { rows } = await query<MediaDtoRow>(
    `SELECT ${MEDIA_COLUMNS}, fam.name AS family_name FROM media m JOIN families fam ON fam.id = m.family_id
      WHERE ${where.join(" AND ")} AND m.immich_asset_id = ANY(${idsParam}::uuid[])
      ORDER BY array_position(${idsParam}::uuid[], m.immich_asset_id)`, params);
  return { items: rows.map(mediaDto), nextPage: found.nextPage };
}

/** A smart album's photos now: a search (relevance order) or filters (newest first), at most `limit`. */
export async function evaluateSmartAlbum(
  conn: ImmichConn | null, familyId: string, filters: MediaFilter & { q?: string }, limit: number, opts: { ownOnly?: boolean } = {},
) {
  const { q, ...f } = filters;
  if (q) {
    if (!conn) throw new HttpError(503, "Photos are unavailable right now");
    const out: ReturnType<typeof mediaDto>[] = [];
    let page: number | null = 1;
    while (page && out.length < limit) {
      const r = await smartSearchLibrary(conn, familyId, q, f, page, opts);
      out.push(...r.items);
      page = r.nextPage;
    }
    return out.slice(0, limit);
  }
  const { where, params, add } = filterSql(f, familyId);
  if (opts.ownOnly) where.push("m.family_id = $1");
  const { rows } = await query<MediaDtoRow>(
    `SELECT ${MEDIA_COLUMNS}, fam.name AS family_name FROM media m JOIN families fam ON fam.id = m.family_id
      WHERE ${where.join(" AND ")} ORDER BY ${SORT_TS} DESC, m.id DESC LIMIT ${add(limit)}`, params);
  return rows.map(mediaDto);
}
