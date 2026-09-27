import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { parseRef, CORE_TYPES, type CoreType } from "../lib/refs.js";
import { signMediaUrl } from "../lib/media/urls.js";
import { likeEscape } from "../lib/validate.js";
import { loadReadable, readableWhere, scopeOf } from "../lib/access.js";
import { badRequest } from "../lib/errors.js";

export interface EntitySummary {
  type: CoreType; id: string; label: string; subtitle: string | null; thumbUrl: string | null;
  /** Set when the entity belongs to another family (seen through a shared trip). */
  familyName: string | null;
}

const thumb = (mediaId: string | null) => (mediaId ? signMediaUrl(mediaId, "thumbnail") : null);

/**
 * Display summaries for ids of one type — only those this family may see
 * ($1 = my family). Another family's entity carries its family's name.
 */
async function summariesFor(familyId: string, type: CoreType, ids: string[]): Promise<Map<string, EntitySummary>> {
  const out = new Map<string, EntitySummary>();
  if (ids.length === 0) return out;
  const other = (r: { family_id: string; family_name: string }) => (r.family_id === familyId ? null : r.family_name);
  const fam = "JOIN families f ON f.id = t.family_id";
  if (type === "visit") {
    const { rows } = await query<any>(
      `SELECT t.id, t.title, t.occurred_on, t.family_id, f.name AS family_name FROM visits t ${fam}
        WHERE t.id = ANY($2::uuid[]) AND ${readableWhere("visit", "t", "$1")}`, [familyId, ids]);
    for (const r of rows) out.set(r.id, { type, id: r.id, label: r.title, subtitle: r.occurred_on, thumbUrl: null, familyName: other(r) });
  } else if (type === "trip") {
    const { rows } = await query<any>(
      `SELECT t.id, t.name, t.start_date, t.cover_photo_url, t.family_id, f.name AS family_name FROM trips t ${fam}
        WHERE t.id = ANY($2::uuid[]) AND ${readableWhere("trip", "t", "$1")}`, [familyId, ids]);
    for (const r of rows) out.set(r.id, { type, id: r.id, label: r.name, subtitle: r.start_date, thumbUrl: r.cover_photo_url ?? null, familyName: other(r) });
  } else if (type === "person") {
    const { rows } = await query<any>(
      `SELECT t.id, t.display_name, t.relationship, t.family_id, f.name AS family_name, m.id AS avatar_id
         FROM people t ${fam} LEFT JOIN media m ON m.id = t.avatar_media_id AND m.family_id = t.family_id
        WHERE t.id = ANY($2::uuid[]) AND ${readableWhere("person", "t", "$1")}`, [familyId, ids]);
    for (const r of rows) {
      // Another family's person: name and picture only.
      const mine = r.family_id === familyId;
      out.set(r.id, { type, id: r.id, label: r.display_name, subtitle: mine ? r.relationship || null : null, thumbUrl: thumb(r.avatar_id), familyName: other(r) });
    }
  } else if (type === "media") {
    const { rows } = await query<any>(
      `SELECT t.id, t.caption, t.original_name, t.family_id, f.name AS family_name FROM media t ${fam}
        WHERE t.id = ANY($2::uuid[]) AND ${readableWhere("media", "t", "$1")}`, [familyId, ids]);
    for (const r of rows) out.set(r.id, { type, id: r.id, label: r.caption || r.original_name || "Photo", subtitle: null, thumbUrl: thumb(r.id), familyName: other(r) });
  } else if (type === "document") {
    const { rows } = await query<any>(
      `SELECT t.id, t.title, t.doc_type FROM documents t WHERE t.id = ANY($2::uuid[]) AND ${readableWhere("document", "t", "$1")}`, [familyId, ids]);
    for (const r of rows) out.set(r.id, { type, id: r.id, label: r.title, subtitle: r.doc_type, thumbUrl: null, familyName: null });
  }
  return out;
}

/** People linked to this one across families ("our Grandma is your Grandma"), accepted only. */
export async function linkedPeople(personId: string): Promise<string[]> {
  const { rows } = await query<{ other: string }>(
    `SELECT CASE WHEN person_a = $1 THEN person_b ELSE person_a END AS other
       FROM person_links WHERE status = 'accepted' AND (person_a = $1 OR person_b = $1)`, [personId]);
  return rows.map((r) => r.other);
}

export async function relationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  /**
   * What an entity is linked to. Links from any family count, as long as both
   * ends are something this family may see. For a person, the relations of
   * the same person in other families (accepted person links) are merged in.
   */
  app.get("/api/relations", async (req) => {
    const ref = parseRef(z.object({ entity: z.string().max(100) }).parse(req.query).entity);
    if (!ref) throw badRequest("Invalid entity reference");
    const scope = scopeOf(req);
    await loadReadable(ref.type, ref.id, scope);
    const ids = ref.type === "person" ? [ref.id, ...(await linkedPeople(ref.id))] : [ref.id];

    const { rows } = await query<any>(
      `SELECT id, family_id, from_type, from_id, to_type, to_id, role FROM links
        WHERE (from_type = $1 AND from_id = ANY($2::uuid[])) OR (to_type = $1 AND to_id = ANY($2::uuid[]))
        ORDER BY created_at ASC`,
      [ref.type, ids]);

    // Compute the "other" ref for each link, then batch-resolve summaries per type (unreadable ones drop out).
    const others = rows.map((r) => {
      const isFrom = r.from_type === ref.type && ids.includes(r.from_id);
      return {
        linkId: r.id, role: r.role, canRemove: r.family_id === scope.familyId,
        via: isFrom ? r.from_id : r.to_id,
        type: (isFrom ? r.to_type : r.from_type) as CoreType, id: isFrom ? r.to_id : r.from_id,
      };
    });
    const readableEnds = await summariesFor(scope.familyId, ref.type, ids);
    const byType = new Map<CoreType, string[]>();
    for (const o of others) byType.set(o.type, [...(byType.get(o.type) ?? []), o.id]);
    const resolved = new Map<string, EntitySummary>();
    for (const [type, typeIds] of byType) for (const [id, s] of await summariesFor(scope.familyId, type, typeIds)) resolved.set(`${type}:${id}`, s);

    const seen = new Set<string>();
    return others
      .filter((o) => readableEnds.has(o.via))
      .map((o) => ({ linkId: o.linkId, role: o.role, canRemove: o.canRemove, entity: resolved.get(`${o.type}:${o.id}`) }))
      .filter((r) => {
        // drop dangling or unreadable ends, and the same entity reached through two linked people
        if (!r.entity) return false;
        const key = `${r.entity.type}:${r.entity.id}:${r.role}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });

  /** Find something to link: anything this family may see (another family's people via shared trips). */
  app.get("/api/entities/search", async (req) => {
    const { type, q } = z.object({ type: z.enum(CORE_TYPES), q: z.string().max(200).optional() }).parse(req.query);
    const term = (q ?? "").trim();
    if (term.length === 0) return [];
    const like = `%${likeEscape(term)}%`;
    const fam = req.user.familyId;
    const column: Record<CoreType, string> = {
      visit: "t.title", trip: "t.name", person: "t.display_name", media: "COALESCE(NULLIF(t.caption, ''), t.original_name)", document: "t.title",
    };
    const table: Record<CoreType, string> = { visit: "visits", trip: "trips", person: "people", media: "media", document: "documents" };
    const { rows } = await query<{ id: string }>(
      `SELECT t.id FROM ${table[type]} t WHERE ${column[type]} ILIKE $2 AND ${readableWhere(type, "t", "$1")}
        ORDER BY ${column[type]} ASC LIMIT 20`, [fam, like]);
    const summaries = await summariesFor(fam, type, rows.map((r) => r.id));
    return rows.map((r) => summaries.get(r.id)).filter(Boolean).map((s) => ({
      type: s!.type, id: s!.id, label: s!.familyName ? `${s!.label} (${s!.familyName})` : s!.label, thumbUrl: s!.thumbUrl, familyName: s!.familyName,
    }));
  });
}
