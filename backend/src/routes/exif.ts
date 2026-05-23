import type { FastifyInstance } from "fastify";
import exifr from "exifr";
import { requireAuth } from "../lib/auth.js";

/** Extract GPS coordinates and capture date from an uploaded photo's EXIF data. */
export async function exifRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/exif", async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: "No file provided" });
    const buf = await part.toBuffer();

    let lat: number | null = null;
    let lng: number | null = null;
    let date: string | null = null;
    try {
      const gps = await exifr.gps(buf);
      if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
        lat = gps.latitude;
        lng = gps.longitude;
      }
    } catch {
      /* no GPS */
    }
    try {
      const meta = await exifr.parse(buf, ["DateTimeOriginal", "CreateDate"]);
      const d = meta?.DateTimeOriginal ?? meta?.CreateDate;
      if (d) date = new Date(d).toISOString().slice(0, 10);
    } catch {
      /* no date */
    }
    return { lat, lng, date };
  });
}
