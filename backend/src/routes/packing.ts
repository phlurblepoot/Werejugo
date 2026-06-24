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
}
