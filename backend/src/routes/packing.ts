import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { loadEditable, loadReadable, scopeOf } from "../lib/access.js";
import { forbidden, notFound } from "../lib/errors.js";
import { uuid } from "../lib/validate.js";

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
async function loadVisible(familyId: string, id: string): Promise<ListRow> {
  const { rows } = await query<ListRow>(`${SUMMARY} WHERE l.id = $1 AND (l.family_id = $2 OR l.is_builtin)`, [id, familyId]);
  if (!rows[0]) throw notFound("Packing list not found");
  return rows[0];
}
/** A list the family may change: its own. Built-ins are read-only (403). */
async function loadMutable(familyId: string, id: string): Promise<ListRow> {
  const list = await loadVisible(familyId, id);
  if (list.is_builtin) throw forbidden("Built-in lists are read-only");
  return list;
}
async function itemsOf(listId: string) {
  const { rows } = await query<ItemRow>("SELECT id, label, category, qty, checked, seq FROM packing_items WHERE list_id = $1 ORDER BY category ASC, seq ASC, created_at ASC", [listId]);
  return rows.map(itemDto);
}

const qty = z.coerce.number().int().min(0).max(9999).nullish();
const seq = z.coerce.number().int().min(0).max(100000);

export async function packingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/packing/templates", async (req) => {
    const { rows } = await query<ListRow>(
      `${SUMMARY} WHERE l.trip_id IS NULL AND (l.family_id = $1 OR l.is_builtin) ORDER BY l.is_builtin ASC, l.name ASC`, [req.user.familyId]);
    return rows.map(summaryDto);
  });

  app.get("/api/packing/lists/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const list = await loadVisible(req.user.familyId, id);
    return { ...summaryDto(list), items: await itemsOf(id) };
  });

  app.post("/api/packing/lists/:id/items", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await loadMutable(req.user.familyId, id);
    const b = z.object({ label: z.string().min(1).max(200), category: z.string().max(80).optional(), qty }).parse(req.body);
    const { rows } = await query<ItemRow>(
      `INSERT INTO packing_items (list_id, label, category, qty, seq)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(seq), -1) + 1 FROM packing_items WHERE list_id = $1))
       RETURNING id, label, category, qty, checked, seq`,
      [id, b.label, b.category ?? "", b.qty ?? null]);
    return reply.code(201).send(itemDto(rows[0]));
  });

  app.patch("/api/packing/items/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    await loadEditable("packing_item", id, scopeOf(req));
    const b = z.object({
      label: z.string().min(1).max(200).optional(), category: z.string().max(80).optional(),
      qty, checked: z.boolean().optional(), seq: seq.optional(),
    }).parse(req.body);
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
    await loadEditable("packing_item", id, scopeOf(req));
    await query("DELETE FROM packing_items WHERE id = $1", [id]);
    return reply.code(204).send();
  });

  app.patch("/api/packing/lists/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    await loadMutable(req.user.familyId, id);
    const { name } = z.object({ name: z.string().min(1).max(160) }).parse(req.body);
    await query("UPDATE packing_lists SET name = $1 WHERE id = $2 AND family_id = $3", [name, id, req.user.familyId]);
    return summaryDto(await loadVisible(req.user.familyId, id));
  });

  app.delete("/api/packing/lists/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    await loadMutable(req.user.familyId, id);
    await query("DELETE FROM packing_lists WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    return reply.code(204).send();
  });

  // Copy items from a visible source list into a destination list, unchecked.
  async function copyItems(client: import("pg").PoolClient, destId: string, sourceId: string) {
    await client.query(
      `INSERT INTO packing_items (list_id, label, category, qty, checked, seq)
       SELECT $1, label, category, qty, false, seq FROM packing_items WHERE list_id = $2 ORDER BY seq`,
      [destId, sourceId]);
  }

  /** This family's list for a trip (packing is private per family, even on a shared trip). */
  async function tripList(familyId: string, tripId: string): Promise<ListRow | null> {
    const { rows } = await query<ListRow>(`${SUMMARY} WHERE l.trip_id = $1 AND l.family_id = $2`, [tripId, familyId]);
    return rows[0] ?? null;
  }

  app.get("/api/trips/:tripId/packing", async (req) => {
    const tripId = (req.params as { tripId: string }).tripId;
    await loadReadable("trip", tripId, scopeOf(req));
    const list = await tripList(req.user.familyId, tripId);
    return { list: list ? { ...summaryDto(list), items: await itemsOf(list.id) } : null };
  });

  app.post("/api/trips/:tripId/packing", async (req, reply) => {
    const tripId = (req.params as { tripId: string }).tripId;
    await loadReadable("trip", tripId, scopeOf(req));
    const b = z.object({ name: z.string().max(160).optional(), fromTemplateId: uuid.optional(), fromTripId: uuid.optional() }).parse(req.body ?? {});

    // Resolve a source list id (a visible template, or another trip's list).
    let sourceId: string | null = null;
    if (b.fromTemplateId) sourceId = (await loadVisible(req.user.familyId, b.fromTemplateId)).id;
    else if (b.fromTripId) {
      const src = await tripList(req.user.familyId, b.fromTripId);
      if (!src) throw notFound("That trip has no packing list");
      sourceId = src.id;
    }

    const id = await tx(async (client) => {
      // One list per trip per family: if two requests race, the second gets the first's list.
      const ins = await client.query<{ id: string }>(
        `INSERT INTO packing_lists (family_id, trip_id, name, created_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (trip_id, family_id) WHERE trip_id IS NOT NULL DO NOTHING RETURNING id`,
        [req.user.familyId, tripId, b.name ?? "Packing", req.user.id]);
      if (!ins.rows[0]) return null;
      if (sourceId) await copyItems(client, ins.rows[0].id, sourceId);
      return ins.rows[0].id;
    });
    const list = id ? await loadVisible(req.user.familyId, id) : (await tripList(req.user.familyId, tripId))!;
    return reply.code(id ? 201 : 200).send({ ...summaryDto(list), items: await itemsOf(list.id) });
  });

  app.post("/api/packing/templates", async (req, reply) => {
    const b = z.object({ name: z.string().min(1).max(160), fromListId: uuid.optional() }).parse(req.body);
    if (b.fromListId) await loadVisible(req.user.familyId, b.fromListId);
    const id = await tx(async (client) => {
      const ins = await client.query<{ id: string }>(
        "INSERT INTO packing_lists (family_id, trip_id, name, created_by) VALUES ($1,NULL,$2,$3) RETURNING id",
        [req.user.familyId, b.name, req.user.id]);
      const newId = ins.rows[0].id;
      if (b.fromListId) await copyItems(client, newId, b.fromListId);
      return newId;
    });
    const list = await loadVisible(req.user.familyId, id);
    return reply.code(201).send({ ...summaryDto(list), items: await itemsOf(id) });
  });
}
