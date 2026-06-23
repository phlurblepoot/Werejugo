import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { extractExif } from "../lib/exif.js";

/** Extract GPS coordinates and capture date from an uploaded photo's EXIF data. */
export async function exifRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/exif", async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: "No file provided" });
    const { takenAt, lat, lng } = await extractExif(await part.toBuffer());
    // The map editor expects a date-only string.
    return { lat, lng, date: takenAt ? takenAt.slice(0, 10) : null };
  });
}
