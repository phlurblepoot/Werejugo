import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { saveUpload } from "../lib/upload.js";

// Built-in icon names the frontend knows how to render.
export const BUILTIN_ICONS = [
  "pin", "plane", "ship", "car", "utensils", "home", "star", "camera",
  "heart", "flag", "mountain", "tree", "beach", "hotel", "coffee", "wine",
];

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Generic image upload (used for custom map overlays). Returns a URL.
  app.post("/api/uploads", async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: "No file provided" });
    try {
      const url = await saveUpload(part);
      return reply.code(201).send({ url });
    } catch {
      return reply.code(400).send({ error: "Unsupported file type" });
    }
  });

  app.get("/api/icons", async (req) => {
    const { rows } = await query<{ id: string; name: string; url: string }>(
      "SELECT id, name, url FROM icons WHERE family_id = $1 ORDER BY created_at DESC",
      [req.user.familyId],
    );
    return { builtin: BUILTIN_ICONS, custom: rows };
  });

  // Upload a custom icon. Multipart with a `file` part; optional `name` field.
  app.post("/api/icons", async (req, reply) => {
    let url: string | null = null;
    let name = "Custom icon";
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        try {
          url = await saveUpload(part);
        } catch {
          return reply.code(400).send({ error: "Unsupported file type" });
        }
      } else if (part.fieldname === "name" && typeof part.value === "string") {
        name = part.value.slice(0, 120) || name;
      }
    }
    if (!url) return reply.code(400).send({ error: "No file provided" });

    const { rows } = await query<{ id: string; name: string; url: string }>(
      "INSERT INTO icons (family_id, name, url, created_by) VALUES ($1,$2,$3,$4) RETURNING id, name, url",
      [req.user.familyId, name, url, req.user.id],
    );
    return reply.code(201).send(rows[0]);
  });

  app.delete("/api/icons/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const res = await query("DELETE FROM icons WHERE id = $1 AND family_id = $2", [
      id,
      req.user.familyId,
    ]);
    if (!res.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });
}
