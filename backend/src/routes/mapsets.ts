import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { loadVisit } from "./visits.js";

const upsertSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  baseKind: z.enum(["vector", "custom"]).optional(),
  styleUrl: z.string().url().nullish(),
  overlayUrl: z.string().nullish(),
  overlayBounds: z.array(z.number()).length(4).nullish(),
  defaultLng: z.number().optional(),
  defaultLat: z.number().optional(),
  defaultZoom: z.number().optional(),
});

interface MapSetRow {
  id: string;
  name: string;
  description: string;
  base_kind: string;
  style_url: string | null;
  overlay_url: string | null;
  overlay_bounds: number[] | null;
  default_lng: number;
  default_lat: number;
  default_zoom: number;
  created_at: string;
}

function toDto(r: MapSetRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    baseKind: r.base_kind,
    styleUrl: r.style_url,
    overlayUrl: r.overlay_url,
    overlayBounds: r.overlay_bounds,
    defaultLng: r.default_lng,
    defaultLat: r.default_lat,
    defaultZoom: r.default_zoom,
    createdAt: r.created_at,
  };
}

export async function mapSetRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/map-sets", async (req) => {
    const { rows } = await query<MapSetRow>(
      "SELECT * FROM map_sets WHERE family_id = $1 ORDER BY created_at ASC",
      [req.user.familyId],
    );
    return rows.map(toDto);
  });

  app.post("/api/map-sets", async (req, reply) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const { rows } = await query<MapSetRow>(
      `INSERT INTO map_sets
        (family_id, name, description, base_kind, style_url, overlay_url, overlay_bounds,
         default_lng, default_lat, default_zoom, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        req.user.familyId,
        b.name,
        b.description ?? "",
        b.baseKind ?? "vector",
        b.styleUrl ?? null,
        b.overlayUrl ?? null,
        b.overlayBounds ?? null,
        b.defaultLng ?? 0,
        b.defaultLat ?? 20,
        b.defaultZoom ?? 1.5,
        req.user.id,
      ],
    );
    return reply.code(201).send(toDto(rows[0]));
  });

  app.patch("/api/map-sets/:id", async (req, reply) => {
    const parsed = upsertSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const id = (req.params as { id: string }).id;
    const b = parsed.data;
    const { rows } = await query<MapSetRow>(
      `UPDATE map_sets SET
         name = COALESCE($3, name),
         description = COALESCE($4, description),
         base_kind = COALESCE($5, base_kind),
         style_url = COALESCE($6, style_url),
         overlay_url = COALESCE($7, overlay_url),
         overlay_bounds = COALESCE($8, overlay_bounds),
         default_lng = COALESCE($9, default_lng),
         default_lat = COALESCE($10, default_lat),
         default_zoom = COALESCE($11, default_zoom),
         updated_at = now()
       WHERE id = $1 AND family_id = $2
       RETURNING *`,
      [
        id,
        req.user.familyId,
        b.name ?? null,
        b.description ?? null,
        b.baseKind ?? null,
        b.styleUrl ?? null,
        b.overlayUrl ?? null,
        b.overlayBounds ?? null,
        b.defaultLng ?? null,
        b.defaultLat ?? null,
        b.defaultZoom ?? null,
      ],
    );
    if (!rows[0]) return reply.code(404).send({ error: "Not found" });
    return toDto(rows[0]);
  });

  app.delete("/api/map-sets/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM map_sets WHERE id = $1 AND family_id = $2", [
      id,
      req.user.familyId,
    ]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });

  // --- Map ↔ visit membership ---
  async function ownsMapSet(familyId: string, id: string): Promise<boolean> {
    const { rowCount } = await query("SELECT 1 FROM map_sets WHERE id = $1 AND family_id = $2", [id, familyId]);
    return Boolean(rowCount);
  }

  app.get("/api/map-sets/:id/visits", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsMapSet(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const { rows } = await query<{ visit_id: string }>(
      "SELECT visit_id FROM map_set_visits WHERE map_set_id = $1 ORDER BY seq ASC", [id]);
    return Promise.all(rows.map((r) => loadVisit(req.user.familyId, r.visit_id)));
  });

  app.post("/api/map-sets/:id/visits", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await ownsMapSet(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    const parsed = z.object({ visitId: z.string().uuid(), seq: z.number().int().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const owns = await query("SELECT 1 FROM visits WHERE id = $1 AND family_id = $2", [parsed.data.visitId, req.user.familyId]);
    if (!owns.rowCount) return reply.code(404).send({ error: "Visit not found" });
    await query(
      `INSERT INTO map_set_visits (map_set_id, visit_id, seq) VALUES ($1,$2,$3)
       ON CONFLICT (map_set_id, visit_id) DO UPDATE SET seq = EXCLUDED.seq`,
      [id, parsed.data.visitId, parsed.data.seq ?? 0]);
    return reply.code(201).send({ ok: true });
  });

  app.delete("/api/map-sets/:id/visits/:visitId", async (req, reply) => {
    const { id, visitId } = req.params as { id: string; visitId: string };
    if (!(await ownsMapSet(req.user.familyId, id))) return reply.code(404).send({ error: "Not found" });
    await query("DELETE FROM map_set_visits WHERE map_set_id = $1 AND visit_id = $2", [id, visitId]);
    return reply.code(204).send();
  });
}
