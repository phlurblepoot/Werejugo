import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";

interface ListRow { id: string; name: string; trip_id: string | null; is_builtin: boolean; item_count: number; checked_count: number; }
interface ItemRow { id: string; label: string; category: string; qty: number | null; checked: boolean; seq: number; }

const summaryDto = (r: ListRow) => ({ id: r.id, name: r.name, tripId: r.trip_id, isBuiltin: r.is_builtin, itemCount: r.item_count, checkedCount: r.checked_count });
const itemDto = (r: ItemRow) => ({ id: r.id, label: r.label, category: r.category, qty: r.qty, checked: r.checked, seq: r.seq });

const SUMMARY = `
  SELECT l.id, l.name, l.trip_id, l.is_builtin,
    (SELECT COUNT(*)::int FROM packing_items WHERE list_id = l.id) AS item_count,
    (SELECT COUNT(*)::int FROM packing_items WHERE list_id = l.id AND checked) AS checked_count
  FROM packing_lists l`;

/** A list the family may *see* (its own, or a built-in). */
async function loadVisible(familyId: string, id: string): Promise<ListRow | null> {
  const { rows } = await query<ListRow>(`${SUMMARY} WHERE l.id = $1 AND (l.family_id = $2 OR l.is_builtin)`, [id, familyId]);
  return rows[0] ?? null;
}
async function itemsOf(listId: string) {
  const { rows } = await query<ItemRow>("SELECT id, label, category, qty, checked, seq FROM packing_items WHERE list_id = $1 ORDER BY category ASC, seq ASC, created_at ASC", [listId]);
  return rows.map(itemDto);
}

export async function packingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/packing/templates", async (req) => {
    const { rows } = await query<ListRow>(
      `${SUMMARY} WHERE l.trip_id IS NULL AND (l.family_id = $1 OR l.is_builtin) ORDER BY l.is_builtin ASC, l.name ASC`, [req.user.familyId]);
    return rows.map(summaryDto);
  });

  app.get("/api/packing/lists/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const list = await loadVisible(req.user.familyId, id);
    if (!list) return reply.code(404).send({ error: "Not found" });
    return { ...summaryDto(list), items: await itemsOf(id) };
  });

  // Returns null=404, "builtin"=403, or the row for a family-owned (non-builtin) list.
  async function loadMutable(familyId: string, id: string): Promise<ListRow | "builtin" | null> {
    const list = await loadVisible(familyId, id);
    if (!list) return null;
    if (list.is_builtin) return "builtin";
    return list;
  }
  function guardReply(reply: import("fastify").FastifyReply, r: ListRow | "builtin" | null): boolean {
    if (r === null) { reply.code(404).send({ error: "Not found" }); return false; }
    if (r === "builtin") { reply.code(403).send({ error: "Built-in lists are read-only" }); return false; }
    return true;
  }

  app.post("/api/packing/lists/:id/items", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const g = await loadMutable(req.user.familyId, id);
    if (!guardReply(reply, g)) return;
    const parsed = z.object({ label: z.string().min(1).max(200), category: z.string().max(80).optional(), qty: z.coerce.number().int().nullish() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const seq = await query<{ seq: number }>("SELECT COALESCE(MAX(seq),-1)+1 AS seq FROM packing_items WHERE list_id = $1", [id]);
    const { rows } = await query<ItemRow>(
      "INSERT INTO packing_items (list_id, label, category, qty, seq) VALUES ($1,$2,$3,$4,$5) RETURNING id, label, category, qty, checked, seq",
      [id, b.label, b.category ?? "", b.qty ?? null, seq.rows[0].seq]);
    return reply.code(201).send(itemDto(rows[0]));
  });

  app.patch("/api/packing/items/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const owner = await query<{ list_id: string }>(
      `SELECT i.list_id FROM packing_items i JOIN packing_lists l ON l.id = i.list_id
       WHERE i.id = $1 AND l.family_id = $2 AND l.is_builtin = false`, [id, req.user.familyId]);
    if (!owner.rowCount) return reply.code(404).send({ error: "Not found" });
    const parsed = z.object({
      label: z.string().min(1).max(200).optional(), category: z.string().max(80).optional(),
      qty: z.coerce.number().int().nullish(), checked: z.boolean().optional(), seq: z.coerce.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    const { rows } = await query<ItemRow>(
      `UPDATE packing_items SET label = COALESCE($2,label), category = COALESCE($3,category),
         qty = CASE WHEN $4::boolean THEN $5 ELSE qty END,
         checked = COALESCE($6,checked), seq = COALESCE($7,seq)
       WHERE id = $1 RETURNING id, label, category, qty, checked, seq`,
      [id, b.label ?? null, b.category ?? null, has("qty"), b.qty ?? null, b.checked ?? null, b.seq ?? null]);
    return itemDto(rows[0]);
  });

  app.delete("/api/packing/items/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query(
      `DELETE FROM packing_items i USING packing_lists l
       WHERE i.id = $1 AND l.id = i.list_id AND l.family_id = $2 AND l.is_builtin = false`, [id, req.user.familyId]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });

  app.patch("/api/packing/lists/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const g = await loadMutable(req.user.familyId, id);
    if (!guardReply(reply, g)) return;
    const parsed = z.object({ name: z.string().min(1).max(160) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await query("UPDATE packing_lists SET name = $1 WHERE id = $2", [parsed.data.name, id]);
    return summaryDto((await loadVisible(req.user.familyId, id))!);
  });

  app.delete("/api/packing/lists/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const g = await loadMutable(req.user.familyId, id);
    if (!guardReply(reply, g)) return;
    await query("DELETE FROM packing_lists WHERE id = $1", [id]);
    return reply.code(204).send();
  });
}
