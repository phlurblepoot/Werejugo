import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { signFileUrl } from "../lib/filesign.js";
import { assertRefs, readableWhere, scopeOf } from "../lib/access.js";
import { notFound } from "../lib/errors.js";
import { uuid } from "../lib/validate.js";

interface PersonRow {
  id: string; display_name: string; relationship: string; notes: string;
  user_id: string | null; avatar_media_id: string | null;
  avatar_rel: string | null; avatar_thumb: string | null; created_at: string;
}

function toDto(r: PersonRow) {
  const avatarRel = r.avatar_thumb ?? r.avatar_rel;
  return {
    id: r.id,
    displayName: r.display_name,
    relationship: r.relationship,
    notes: r.notes,
    userId: r.user_id,
    avatarMediaId: r.avatar_media_id,
    avatarUrl: avatarRel ? signFileUrl(avatarRel) : null,
    createdAt: r.created_at,
  };
}

const SELECT = `
  SELECT p.id, p.display_name, p.relationship, p.notes, p.user_id, p.avatar_media_id,
         m.rel_path AS avatar_rel, m.thumb_rel_path AS avatar_thumb, p.created_at
  FROM people p LEFT JOIN media m ON m.id = p.avatar_media_id AND m.family_id = p.family_id`;

const upsertSchema = z.object({
  displayName: z.string().min(1).max(160),
  relationship: z.string().max(160).optional(),
  notes: z.string().max(4000).optional(),
  userId: uuid.nullish(),
  avatarMediaId: uuid.nullish(),
});

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/people", async (req) => {
    const { rows } = await query<PersonRow>(
      `${SELECT} WHERE p.family_id = $1 ORDER BY p.display_name ASC`, [req.user.familyId]);
    return rows.map(toDto);
  });

  app.get("/api/people/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const fam = req.user.familyId;
    const { rows } = await query<PersonRow & { family_id: string; family_name: string }>(
      `SELECT p.id, p.display_name, p.relationship, p.notes, p.user_id, p.avatar_media_id, p.created_at,
              m.rel_path AS avatar_rel, m.thumb_rel_path AS avatar_thumb, p.family_id, f.name AS family_name
         FROM people p JOIN families f ON f.id = p.family_id
         LEFT JOIN media m ON m.id = p.avatar_media_id AND m.family_id = p.family_id
        WHERE p.id = $1 AND ${readableWhere("person", "p", "$2")}`, [id, fam]);
    const r = rows[0];
    if (!r) throw notFound("Person not found");
    // The same person in other families (accepted or waiting), when we can see them.
    const links = (await query<{ link_id: string; status: string; person_id: string; display_name: string; family_name: string; incoming: boolean }>(
      `SELECT l.id AS link_id, l.status, o.id AS person_id, o.display_name, f.name AS family_name, (l.person_b = $1) AS incoming
         FROM person_links l
         JOIN people o ON o.id = CASE WHEN l.person_a = $1 THEN l.person_b ELSE l.person_a END
         JOIN families f ON f.id = o.family_id
        WHERE (l.person_a = $1 OR l.person_b = $1) AND ${readableWhere("person", "o", "$2")}`, [id, fam])).rows
      .map((l) => ({ linkId: l.link_id, status: l.status, personId: l.person_id, displayName: l.display_name, familyName: l.family_name, incoming: l.incoming }));
    if (r.family_id !== fam) {
      // Another family's person (we share a trip): name and picture only.
      const avatarRel = r.avatar_thumb ?? r.avatar_rel;
      return {
        id: r.id, displayName: r.display_name, relationship: "", notes: "", userId: null, avatarMediaId: null,
        avatarUrl: avatarRel ? signFileUrl(avatarRel) : null, createdAt: r.created_at,
        familyId: r.family_id, familyName: r.family_name, readOnly: true, links: links.filter((l) => l.status === "accepted"),
      };
    }
    return { ...toDto(r), familyId: r.family_id, familyName: r.family_name, readOnly: false, links };
  });

  app.post("/api/people", async (req, reply) => {
    const b = upsertSchema.parse(req.body);
    await assertRefs(scopeOf(req), { media: b.avatarMediaId, user: b.userId }, { mode: "own" });
    const ins = await query<{ id: string }>(
      `INSERT INTO people (family_id, display_name, relationship, notes, user_id, avatar_media_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user.familyId, b.displayName, b.relationship ?? "", b.notes ?? "", b.userId ?? null, b.avatarMediaId ?? null]);
    const { rows } = await query<PersonRow>(`${SELECT} WHERE p.id = $1 AND p.family_id = $2`, [ins.rows[0].id, req.user.familyId]);
    return reply.code(201).send(toDto(rows[0]));
  });

  app.patch("/api/people/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const owns = await query("SELECT 1 FROM people WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!owns.rowCount) throw notFound("Person not found");
    const b = upsertSchema.partial().parse(req.body);
    await assertRefs(scopeOf(req), { media: b.avatarMediaId, user: b.userId }, { mode: "own" });
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    await query(
      `UPDATE people SET
         display_name = COALESCE($3, display_name),
         relationship = COALESCE($4, relationship),
         notes = COALESCE($5, notes),
         user_id = CASE WHEN $6::boolean THEN $7 ELSE user_id END,
         avatar_media_id = CASE WHEN $8::boolean THEN $9 ELSE avatar_media_id END
       WHERE id = $1 AND family_id = $2`,
      [id, req.user.familyId, b.displayName ?? null, b.relationship ?? null, b.notes ?? null,
       has("userId"), b.userId ?? null, has("avatarMediaId"), b.avatarMediaId ?? null]);
    const { rows } = await query<PersonRow>(`${SELECT} WHERE p.id = $1 AND p.family_id = $2`, [id, req.user.familyId]);
    return toDto(rows[0]);
  });

  app.delete("/api/people/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM people WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) throw notFound("Person not found");
    return reply.code(204).send();
  });

  // Family users available to link a Person to an account.
  app.get("/api/family-members", async (req) => {
    const { rows } = await query<{ id: string; display_name: string; email: string; color: string }>(
      "SELECT id, display_name, email, color FROM users WHERE family_id = $1 ORDER BY display_name ASC",
      [req.user.familyId]);
    return rows.map((r) => ({ id: r.id, displayName: r.display_name, email: r.email, color: r.color }));
  });
}
