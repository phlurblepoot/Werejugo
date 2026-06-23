import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { signFileUrl } from "../lib/filesign.js";

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
  FROM people p LEFT JOIN media m ON m.id = p.avatar_media_id`;

const upsertSchema = z.object({
  displayName: z.string().min(1).max(160),
  relationship: z.string().max(160).optional(),
  notes: z.string().max(4000).optional(),
  userId: z.string().uuid().nullish(),
  avatarMediaId: z.string().uuid().nullish(),
});

async function ownsId(table: "media" | "users", id: string, familyId: string): Promise<boolean> {
  const { rowCount } = await query(`SELECT 1 FROM ${table} WHERE id = $1 AND family_id = $2`, [id, familyId]);
  return Boolean(rowCount);
}

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/people", async (req) => {
    const { rows } = await query<PersonRow>(
      `${SELECT} WHERE p.family_id = $1 ORDER BY p.display_name ASC`, [req.user.familyId]);
    return rows.map(toDto);
  });

  app.get("/api/people/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const { rows } = await query<PersonRow>(
      `${SELECT} WHERE p.id = $1 AND p.family_id = $2`, [id, req.user.familyId]);
    if (!rows[0]) return reply.code(404).send({ error: "Not found" });
    return toDto(rows[0]);
  });

  app.post("/api/people", async (req, reply) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    if (b.avatarMediaId && !(await ownsId("media", b.avatarMediaId, req.user.familyId)))
      return reply.code(404).send({ error: "Avatar media not found" });
    if (b.userId && !(await ownsId("users", b.userId, req.user.familyId)))
      return reply.code(404).send({ error: "User not found" });
    const ins = await query<{ id: string }>(
      `INSERT INTO people (family_id, display_name, relationship, notes, user_id, avatar_media_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user.familyId, b.displayName, b.relationship ?? "", b.notes ?? "", b.userId ?? null, b.avatarMediaId ?? null]);
    const { rows } = await query<PersonRow>(`${SELECT} WHERE p.id = $1`, [ins.rows[0].id]);
    return reply.code(201).send(toDto(rows[0]));
  });

  app.patch("/api/people/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const owns = await query("SELECT 1 FROM people WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!owns.rowCount) return reply.code(404).send({ error: "Not found" });
    const parsed = upsertSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    if (b.avatarMediaId && !(await ownsId("media", b.avatarMediaId, req.user.familyId)))
      return reply.code(404).send({ error: "Avatar media not found" });
    if (b.userId && !(await ownsId("users", b.userId, req.user.familyId)))
      return reply.code(404).send({ error: "User not found" });
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
    const { rows } = await query<PersonRow>(`${SELECT} WHERE p.id = $1`, [id]);
    return toDto(rows[0]);
  });

  app.delete("/api/people/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM people WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
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
