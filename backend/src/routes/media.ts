import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query, tx } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { mediaDirFor, saveMediaUpload, deleteStored, absStoragePath } from "../lib/storage.js";
import { reconcileMediaTrip } from "../lib/reconcile.js";
import { extractExif } from "../lib/exif.js";
import { signFileUrl } from "../lib/filesign.js";

interface MediaRow {
  id: string; kind: string; trip_id: string | null;
  rel_path: string; thumb_rel_path: string | null;
  original_name: string; caption: string; taken_at: string | null;
  width: number | null; height: number | null; created_at: string;
}

function toDto(r: MediaRow) {
  return {
    id: r.id, kind: r.kind, tripId: r.trip_id,
    url: signFileUrl(r.rel_path),
    thumbUrl: r.thumb_rel_path ? signFileUrl(r.thumb_rel_path) : null,
    originalName: r.original_name, caption: r.caption,
    takenAt: r.taken_at, width: r.width, height: r.height, createdAt: r.created_at,
  };
}

async function loadMedia(familyId: string, id: string): Promise<MediaRow | null> {
  const { rows } = await query<MediaRow>(
    "SELECT * FROM media WHERE id = $1 AND family_id = $2", [id, familyId],
  );
  return rows[0] ?? null;
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Upload a new media file (multipart: `file`, optional `caption`).
  app.post("/api/media", async (req, reply) => {
    let caption = "";
    let saved: Awaited<ReturnType<typeof saveMediaUpload>> | null = null;
    let originalName = "";
    for await (const part of req.parts()) {
      if (part.type === "file") {
        originalName = part.filename;
        try {
          saved = await saveMediaUpload(part, mediaDirFor(null, new Date()));
        } catch {
          return reply.code(400).send({ error: "Unsupported file type" });
        }
      } else if (part.fieldname === "caption" && typeof part.value === "string") {
        caption = part.value.slice(0, 500);
      }
    }
    if (!saved) return reply.code(400).send({ error: "No file provided" });
    const exif = await extractExif(absStoragePath(saved.relPath));
    const { rows } = await query<MediaRow>(
      `INSERT INTO media (family_id, kind, rel_path, thumb_rel_path, original_name, caption, width, height, taken_at, geom, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         CASE WHEN $10::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($10,$11),4326) END,
         $12)
       RETURNING *`,
      [req.user.familyId, saved.kind, saved.relPath, saved.thumbRelPath, originalName, caption,
       saved.width, saved.height, exif.takenAt, exif.lng, exif.lat, req.user.id],
    );
    return reply.code(201).send(toDto(rows[0]));
  });

  app.get("/api/media/:id", async (req, reply) => {
    const row = await loadMedia(req.user.familyId, (req.params as { id: string }).id);
    if (!row) return reply.code(404).send({ error: "Not found" });
    return toDto(row);
  });

  const patchSchema = z.object({
    caption: z.string().max(500).optional(),
    tripId: z.string().uuid().nullable().optional(),
  });

  app.patch("/api/media/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = await loadMedia(req.user.familyId, id);
    if (!row) return reply.code(404).send({ error: "Not found" });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;

    if (b.caption !== undefined) {
      await query("UPDATE media SET caption = $2 WHERE id = $1", [id, b.caption]);
    }
    if (Object.prototype.hasOwnProperty.call(b, "tripId")) {
      // Validate the trip belongs to the family (when non-null).
      if (b.tripId) {
        const t = await query("SELECT 1 FROM trips WHERE id = $1 AND family_id = $2", [b.tripId, req.user.familyId]);
        if (!t.rowCount) return reply.code(404).send({ error: "Trip not found" });
      }
      await tx(async (client) => {
        await client.query("UPDATE media SET trip_id = $1 WHERE id = $2", [b.tripId ?? null, id]);
        await reconcileMediaTrip(client, id);
      });
    }
    const updated = await loadMedia(req.user.familyId, id);
    return toDto(updated!);
  });

  app.delete("/api/media/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const row = await loadMedia(req.user.familyId, id);
    if (!row) return reply.code(404).send({ error: "Not found" });
    await query("DELETE FROM media WHERE id = $1", [id]);
    await deleteStored(row.rel_path);
    if (row.thumb_rel_path) await deleteStored(row.thumb_rel_path);
    return reply.code(204).send();
  });
}
