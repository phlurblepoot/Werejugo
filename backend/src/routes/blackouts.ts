import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { loadEditable, scopeOf } from "../lib/access.js";
import { badRequest, notFound } from "../lib/errors.js";
import { endsBeforeStart, ymd } from "../lib/validate.js";

interface BlackoutRow { id: string; label: string; start_date: string; end_date: string; color: string; created_at: string; }
const toDto = (r: BlackoutRow) => ({ id: r.id, label: r.label, startDate: r.start_date, endDate: r.end_date, color: r.color, createdAt: r.created_at });
const SELECT = `SELECT id, label, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, color, created_at FROM blackout_periods`;

const baseSchema = z.object({
  label: z.string().min(1).max(160),
  startDate: ymd,
  endDate: ymd,
  color: z.string().max(40).optional(),
});
const DATE_ORDER = "End date must be on or after the start date";

export async function blackoutRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/blackouts", async (req) => {
    const { rows } = await query<BlackoutRow>(`${SELECT} WHERE family_id = $1 ORDER BY start_date ASC`, [req.user.familyId]);
    return rows.map(toDto);
  });

  app.post("/api/blackouts", async (req, reply) => {
    const b = baseSchema.parse(req.body);
    if (endsBeforeStart(b.startDate, b.endDate)) throw badRequest(DATE_ORDER);
    const { rows } = await query<{ id: string }>(
      "INSERT INTO blackout_periods (family_id, label, start_date, end_date, color) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [req.user.familyId, b.label, b.startDate, b.endDate, b.color ?? "#64748b"]);
    const out = await query<BlackoutRow>(`${SELECT} WHERE id = $1 AND family_id = $2`, [rows[0].id, req.user.familyId]);
    return reply.code(201).send(toDto(out.rows[0]));
  });

  app.patch("/api/blackouts/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const current = await loadEditable<{ start_date: string; end_date: string }>("blackout", id, scopeOf(req));
    const b = baseSchema.partial().parse(req.body);
    // Check the range the row will have after this change, not just the fields sent.
    if (endsBeforeStart(b.startDate ?? current.start_date, b.endDate ?? current.end_date)) throw badRequest(DATE_ORDER);
    const { rows } = await query<BlackoutRow>(
      `UPDATE blackout_periods SET label = COALESCE($3, label),
         start_date = COALESCE($4, start_date), end_date = COALESCE($5, end_date), color = COALESCE($6, color)
       WHERE id = $1 AND family_id = $2
       RETURNING id, label, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, color, created_at`,
      [id, req.user.familyId, b.label ?? null, b.startDate ?? null, b.endDate ?? null, b.color ?? null]);
    if (!rows[0]) throw notFound("Blackout not found");
    return toDto(rows[0]);
  });

  app.delete("/api/blackouts/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM blackout_periods WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!res.rowCount) throw notFound("Blackout not found");
    return reply.code(204).send();
  });
}
