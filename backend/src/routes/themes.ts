import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

const themeSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.string().max(40).default("place"),
  icon: z.string().max(300).default("pin"),
  color: z.string().max(40).default("#2563eb"),
  lineColor: z.string().max(40).optional(),
  lineWidth: z.number().min(0.5).max(20).optional(),
});

interface ThemeRow {
  id: string;
  family_id: string | null;
  name: string;
  kind: string;
  icon: string;
  color: string;
  line_color: string;
  line_width: number;
  is_builtin: boolean;
}

const toDto = (r: ThemeRow) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  icon: r.icon,
  color: r.color,
  lineColor: r.line_color,
  lineWidth: r.line_width,
  isBuiltin: r.is_builtin,
});

export async function themeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/themes", async (req) => {
    const { rows } = await query<ThemeRow>(
      `SELECT * FROM themes WHERE family_id IS NULL OR family_id = $1
       ORDER BY is_builtin DESC, name ASC`,
      [req.user.familyId],
    );
    return rows.map(toDto);
  });

  app.post("/api/themes", async (req, reply) => {
    const parsed = themeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const { rows } = await query<ThemeRow>(
      `INSERT INTO themes (family_id, name, kind, icon, color, line_color, line_width)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.familyId, b.name, b.kind, b.icon, b.color, b.lineColor ?? b.color, b.lineWidth ?? 3],
    );
    return reply.code(201).send(toDto(rows[0]));
  });

  app.patch("/api/themes/:id", async (req, reply) => {
    const parsed = themeSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const id = (req.params as { id: string }).id;
    const b = parsed.data;
    const { rows } = await query<ThemeRow>(
      `UPDATE themes SET
         name = COALESCE($3, name), kind = COALESCE($4, kind), icon = COALESCE($5, icon),
         color = COALESCE($6, color), line_color = COALESCE($7, line_color),
         line_width = COALESCE($8, line_width)
       WHERE id = $1 AND family_id = $2 AND is_builtin = false RETURNING *`,
      [id, req.user.familyId, b.name ?? null, b.kind ?? null, b.icon ?? null, b.color ?? null, b.lineColor ?? null, b.lineWidth ?? null],
    );
    if (!rows[0]) return reply.code(404).send({ error: "Not found (or built-in)" });
    return toDto(rows[0]);
  });

  app.delete("/api/themes/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query(
      "DELETE FROM themes WHERE id = $1 AND family_id = $2 AND is_builtin = false",
      [id, req.user.familyId],
    );
    if (!res.rowCount) return reply.code(404).send({ error: "Not found (or built-in)" });
    return reply.code(204).send();
  });
}
