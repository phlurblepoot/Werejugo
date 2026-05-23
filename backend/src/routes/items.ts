import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { deleteUploadFile, saveUpload } from "../lib/upload.js";

const geometrySchema = z
  .object({
    type: z.enum(["Point", "LineString"]),
    coordinates: z.any(),
  })
  .nullable();

const waypointSchema = z.object({
  label: z.string().min(1).max(200),
  kind: z.enum(["origin", "stop", "destination", "port"]).default("stop"),
  lng: z.number(),
  lat: z.number(),
  seq: z.number().int().optional(),
  arriveAt: z.string().datetime().nullish(),
  departAt: z.string().datetime().nullish(),
});

const itemSchema = z.object({
  kind: z.enum(["place", "food", "flight", "cruise", "drive", "custom"]),
  title: z.string().min(1).max(200),
  notes: z.string().max(5000).optional(),
  themeId: z.string().uuid().nullish(),
  color: z.string().max(40).nullish(),
  icon: z.string().max(200).nullish(),
  occurredOn: z.string().nullish(),
  geometry: geometrySchema.optional(),
  waypoints: z.array(waypointSchema).optional(),
});

async function ownsMapSet(familyId: string, mapSetId: string): Promise<boolean> {
  const { rowCount } = await query("SELECT 1 FROM map_sets WHERE id = $1 AND family_id = $2", [
    mapSetId,
    familyId,
  ]);
  return Boolean(rowCount);
}

async function ownsItem(familyId: string, itemId: string): Promise<string | null> {
  const { rows } = await query<{ map_set_id: string }>(
    `SELECT i.map_set_id FROM items i
     JOIN map_sets m ON m.id = i.map_set_id
     WHERE i.id = $1 AND m.family_id = $2`,
    [itemId, familyId],
  );
  return rows[0]?.map_set_id ?? null;
}

async function loadItem(itemId: string) {
  const { rows } = await query<any>(
    `SELECT i.id, i.map_set_id, i.kind, i.title, i.notes, i.theme_id, i.color, i.icon,
            i.occurred_on, i.properties, i.created_by, i.created_at,
            ST_AsGeoJSON(i.geom) AS geom
     FROM items i WHERE i.id = $1`,
    [itemId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  const wps = await query<any>(
    `SELECT id, label, kind, seq, arrive_at, depart_at, ST_X(geom) AS lng, ST_Y(geom) AS lat
     FROM item_waypoints WHERE item_id = $1 ORDER BY seq ASC`,
    [itemId],
  );
  const photos = await query<any>(
    `SELECT id, url, caption, seq FROM item_photos WHERE item_id = $1 ORDER BY seq ASC, created_at ASC`,
    [itemId],
  );
  return {
    id: r.id,
    mapSetId: r.map_set_id,
    kind: r.kind,
    title: r.title,
    notes: r.notes,
    themeId: r.theme_id,
    color: r.color,
    icon: r.icon,
    occurredOn: r.occurred_on,
    properties: r.properties,
    createdBy: r.created_by,
    createdAt: r.created_at,
    geometry: r.geom ? JSON.parse(r.geom) : null,
    waypoints: wps.rows.map((w) => ({
      id: w.id,
      label: w.label,
      kind: w.kind,
      seq: w.seq,
      lng: w.lng,
      lat: w.lat,
      arriveAt: w.arrive_at,
      departAt: w.depart_at,
    })),
    photos: photos.rows.map((p) => ({ id: p.id, url: p.url, caption: p.caption, seq: p.seq })),
  };
}

async function ownsPhoto(
  familyId: string,
  photoId: string,
): Promise<{ itemId: string; url: string } | null> {
  const { rows } = await query<{ item_id: string; url: string }>(
    `SELECT p.item_id, p.url FROM item_photos p
     JOIN items i ON i.id = p.item_id
     JOIN map_sets m ON m.id = i.map_set_id
     WHERE p.id = $1 AND m.family_id = $2`,
    [photoId, familyId],
  );
  return rows[0] ? { itemId: rows[0].item_id, url: rows[0].url } : null;
}

async function insertWaypoints(
  client: import("pg").PoolClient,
  itemId: string,
  waypoints: z.infer<typeof waypointSchema>[],
): Promise<void> {
  for (let i = 0; i < waypoints.length; i++) {
    const w = waypoints[i];
    await client.query(
      `INSERT INTO item_waypoints (item_id, label, kind, seq, geom, arrive_at, depart_at)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8)`,
      [itemId, w.label, w.kind, w.seq ?? i, w.lng, w.lat, w.arriveAt ?? null, w.departAt ?? null],
    );
  }
}

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/map-sets/:mapSetId/items", async (req, reply) => {
    const mapSetId = (req.params as { mapSetId: string }).mapSetId;
    if (!(await ownsMapSet(req.user.familyId, mapSetId))) {
      return reply.code(404).send({ error: "Map set not found" });
    }
    const { rows } = await query<{ id: string }>(
      "SELECT id FROM items WHERE map_set_id = $1 ORDER BY occurred_on NULLS LAST, created_at ASC",
      [mapSetId],
    );
    const items = await Promise.all(rows.map((r) => loadItem(r.id)));
    return items;
  });

  app.post("/api/map-sets/:mapSetId/items", async (req, reply) => {
    const mapSetId = (req.params as { mapSetId: string }).mapSetId;
    if (!(await ownsMapSet(req.user.familyId, mapSetId))) {
      return reply.code(404).send({ error: "Map set not found" });
    }
    const parsed = itemSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;

    const id = await tx(async (client) => {
      const geomJson = b.geometry ? JSON.stringify(b.geometry) : null;
      const res = await client.query<{ id: string }>(
        `INSERT INTO items (map_set_id, kind, title, notes, theme_id, color, icon, occurred_on, geom, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
           CASE WHEN $9::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($9), 4326) END,
           $10)
         RETURNING id`,
        [
          mapSetId,
          b.kind,
          b.title,
          b.notes ?? "",
          b.themeId ?? null,
          b.color ?? null,
          b.icon ?? null,
          b.occurredOn ?? null,
          geomJson,
          req.user.id,
        ],
      );
      const itemId = res.rows[0].id;
      if (b.waypoints?.length) await insertWaypoints(client, itemId, b.waypoints);
      return itemId;
    });

    return reply.code(201).send(await loadItem(id));
  });

  app.patch("/api/items/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsItem(req.user.familyId, id))) {
      return reply.code(404).send({ error: "Not found" });
    }
    const parsed = itemSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;

    await tx(async (client) => {
      const geomProvided = Object.prototype.hasOwnProperty.call(b, "geometry");
      const geomJson = b.geometry ? JSON.stringify(b.geometry) : null;
      await client.query(
        `UPDATE items SET
           kind = COALESCE($2, kind),
           title = COALESCE($3, title),
           notes = COALESCE($4, notes),
           theme_id = CASE WHEN $5::boolean THEN $6 ELSE theme_id END,
           color = CASE WHEN $7::boolean THEN $8 ELSE color END,
           icon = CASE WHEN $9::boolean THEN $10 ELSE icon END,
           occurred_on = CASE WHEN $11::boolean THEN $12 ELSE occurred_on END,
           geom = CASE WHEN $13::boolean THEN
              (CASE WHEN $14::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($14), 4326) END)
              ELSE geom END,
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          b.kind ?? null,
          b.title ?? null,
          b.notes ?? null,
          Object.prototype.hasOwnProperty.call(b, "themeId"),
          b.themeId ?? null,
          Object.prototype.hasOwnProperty.call(b, "color"),
          b.color ?? null,
          Object.prototype.hasOwnProperty.call(b, "icon"),
          b.icon ?? null,
          Object.prototype.hasOwnProperty.call(b, "occurredOn"),
          b.occurredOn ?? null,
          geomProvided,
          geomJson,
        ],
      );
      if (b.waypoints) {
        await client.query("DELETE FROM item_waypoints WHERE item_id = $1", [id]);
        await insertWaypoints(client, id, b.waypoints);
      }
    });

    return await loadItem(id);
  });

  app.delete("/api/items/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsItem(req.user.familyId, id))) {
      return reply.code(404).send({ error: "Not found" });
    }
    await query("DELETE FROM items WHERE id = $1", [id]);
    return reply.code(204).send();
  });

  // --- Photos ---

  app.post("/api/items/:id/photos", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsItem(req.user.familyId, id))) {
      return reply.code(404).send({ error: "Not found" });
    }
    let url: string | null = null;
    let caption = "";
    for await (const part of req.parts()) {
      if (part.type === "file") {
        try {
          url = await saveUpload(part);
        } catch {
          return reply.code(400).send({ error: "Unsupported file type" });
        }
      } else if (part.fieldname === "caption" && typeof part.value === "string") {
        caption = part.value.slice(0, 500);
      }
    }
    if (!url) return reply.code(400).send({ error: "No file provided" });

    const seqRes = await query<{ seq: number }>(
      "SELECT COALESCE(MAX(seq), -1) + 1 AS seq FROM item_photos WHERE item_id = $1",
      [id],
    );
    const { rows } = await query<{ id: string; url: string; caption: string; seq: number }>(
      `INSERT INTO item_photos (item_id, url, caption, seq, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, url, caption, seq`,
      [id, url, caption, seqRes.rows[0].seq, req.user.id],
    );
    return reply.code(201).send(rows[0]);
  });

  app.patch("/api/photos/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsPhoto(req.user.familyId, id))) {
      return reply.code(404).send({ error: "Not found" });
    }
    const caption = z.object({ caption: z.string().max(500) }).safeParse(req.body);
    if (!caption.success) return reply.code(400).send({ error: caption.error.flatten() });
    const { rows } = await query<{ id: string; url: string; caption: string; seq: number }>(
      "UPDATE item_photos SET caption = $2 WHERE id = $1 RETURNING id, url, caption, seq",
      [id, caption.data.caption],
    );
    return rows[0];
  });

  app.delete("/api/photos/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const owned = await ownsPhoto(req.user.familyId, id);
    if (!owned) return reply.code(404).send({ error: "Not found" });
    await query("DELETE FROM item_photos WHERE id = $1", [id]);
    await deleteUploadFile(owned.url);
    return reply.code(204).send();
  });
}
