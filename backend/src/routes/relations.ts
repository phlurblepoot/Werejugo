import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { parseRef, TABLE_FOR, CORE_TYPES, type CoreType } from "../lib/refs.js";
import { signFileUrl } from "../lib/filesign.js";

export interface EntitySummary {
  type: CoreType; id: string; label: string; subtitle: string | null; thumbUrl: string | null;
}

/** Resolve a set of ids of one type to display summaries. */
async function summariesFor(familyId: string, type: CoreType, ids: string[]): Promise<Map<string, EntitySummary>> {
  const out = new Map<string, EntitySummary>();
  if (ids.length === 0) return out;
  if (type === "visit") {
    const { rows } = await query<any>(
      "SELECT id, title, occurred_on FROM visits WHERE family_id = $1 AND id = ANY($2::uuid[])", [familyId, ids]);
    for (const r of rows) out.set(r.id, { type, id: r.id, label: r.title, subtitle: r.occurred_on, thumbUrl: null });
  } else if (type === "trip") {
    const { rows } = await query<any>(
      "SELECT id, name, start_date, cover_photo_url FROM trips WHERE family_id = $1 AND id = ANY($2::uuid[])", [familyId, ids]);
    for (const r of rows) out.set(r.id, { type, id: r.id, label: r.name, subtitle: r.start_date, thumbUrl: r.cover_photo_url ?? null });
  } else if (type === "person") {
    const { rows } = await query<any>(
      `SELECT p.id, p.display_name, p.relationship, m.rel_path, m.thumb_rel_path
       FROM people p LEFT JOIN media m ON m.id = p.avatar_media_id
       WHERE p.family_id = $1 AND p.id = ANY($2::uuid[])`, [familyId, ids]);
    for (const r of rows) {
      const rel = r.thumb_rel_path ?? r.rel_path;
      out.set(r.id, { type, id: r.id, label: r.display_name, subtitle: r.relationship || null, thumbUrl: rel ? signFileUrl(rel) : null });
    }
  } else if (type === "media") {
    const { rows } = await query<any>(
      "SELECT id, caption, original_name, rel_path, thumb_rel_path FROM media WHERE family_id = $1 AND id = ANY($2::uuid[])", [familyId, ids]);
    for (const r of rows) {
      const rel = r.thumb_rel_path ?? r.rel_path;
      out.set(r.id, { type, id: r.id, label: r.caption || r.original_name || "Photo", subtitle: null, thumbUrl: rel ? signFileUrl(rel) : null });
    }
  } else if (type === "document") {
    const { rows } = await query<any>(
      "SELECT id, title, doc_type FROM documents WHERE family_id = $1 AND id = ANY($2::uuid[])", [familyId, ids]);
    for (const r of rows) out.set(r.id, { type, id: r.id, label: r.title, subtitle: r.doc_type, thumbUrl: null });
  }
  return out;
}

export async function relationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/relations", async (req, reply) => {
    const ref = parseRef((req.query as { entity?: string }).entity ?? "");
    if (!ref) return reply.code(400).send({ error: "Invalid entity reference" });
    const owns = await query(`SELECT 1 FROM ${TABLE_FOR[ref.type]} WHERE id = $1 AND family_id = $2`, [ref.id, req.user.familyId]);
    if (!owns.rowCount) return reply.code(404).send({ error: "Entity not found" });

    const { rows } = await query<any>(
      `SELECT id, from_type, from_id, to_type, to_id, role FROM links
       WHERE family_id = $1 AND ((from_type = $2 AND from_id = $3) OR (to_type = $2 AND to_id = $3))
       ORDER BY created_at ASC`,
      [req.user.familyId, ref.type, ref.id]);

    // Compute the "other" ref for each link, then batch-resolve summaries per type.
    const others = rows.map((r) => {
      const isFrom = r.from_type === ref.type && r.from_id === ref.id;
      return { linkId: r.id, role: r.role, type: (isFrom ? r.to_type : r.from_type) as CoreType, id: isFrom ? r.to_id : r.from_id };
    });
    const byType = new Map<CoreType, string[]>();
    for (const o of others) byType.set(o.type, [...(byType.get(o.type) ?? []), o.id]);
    const resolved = new Map<string, EntitySummary>();
    for (const [type, ids] of byType) for (const [id, s] of await summariesFor(req.user.familyId, type, ids)) resolved.set(`${type}:${id}`, s);

    return others
      .map((o) => ({ linkId: o.linkId, role: o.role, entity: resolved.get(`${o.type}:${o.id}`) }))
      .filter((r) => r.entity); // drop any dangling refs
  });

  app.get("/api/entities/search", async (req, reply) => {
    const { type, q } = req.query as { type?: string; q?: string };
    if (!type || !(CORE_TYPES as readonly string[]).includes(type)) {
      return reply.code(400).send({ error: "Unknown entity type" });
    }
    const term = (q ?? "").trim();
    if (term.length === 0) return [];
    const like = `%${term}%`;
    const fam = req.user.familyId;
    const t = type as CoreType;

    if (t === "visit") {
      const { rows } = await query<any>(
        "SELECT id, title FROM visits WHERE family_id = $1 AND title ILIKE $2 ORDER BY title ASC LIMIT 20", [fam, like]);
      return rows.map((r) => ({ type: t, id: r.id, label: r.title, thumbUrl: null }));
    }
    if (t === "trip") {
      const { rows } = await query<any>(
        "SELECT id, name FROM trips WHERE family_id = $1 AND name ILIKE $2 ORDER BY name ASC LIMIT 20", [fam, like]);
      return rows.map((r) => ({ type: t, id: r.id, label: r.name, thumbUrl: null }));
    }
    if (t === "person") {
      const { rows } = await query<any>(
        `SELECT p.id, p.display_name, m.rel_path, m.thumb_rel_path
         FROM people p LEFT JOIN media m ON m.id = p.avatar_media_id
         WHERE p.family_id = $1 AND p.display_name ILIKE $2 ORDER BY p.display_name ASC LIMIT 20`, [fam, like]);
      return rows.map((r) => {
        const rel = r.thumb_rel_path ?? r.rel_path;
        return { type: t, id: r.id, label: r.display_name, thumbUrl: rel ? signFileUrl(rel) : null };
      });
    }
    if (t === "media") {
      const { rows } = await query<any>(
        `SELECT id, caption, original_name, rel_path, thumb_rel_path FROM media
         WHERE family_id = $1 AND (caption ILIKE $2 OR original_name ILIKE $2) ORDER BY created_at DESC LIMIT 20`, [fam, like]);
      return rows.map((r) => {
        const rel = r.thumb_rel_path ?? r.rel_path;
        return { type: t, id: r.id, label: r.caption || r.original_name || "Photo", thumbUrl: rel ? signFileUrl(rel) : null };
      });
    }
    // document
    const { rows } = await query<any>(
      "SELECT id, title FROM documents WHERE family_id = $1 AND title ILIKE $2 ORDER BY title ASC LIMIT 20", [fam, like]);
    return rows.map((r) => ({ type: t, id: r.id, label: r.title, thumbUrl: null }));
  });
}
