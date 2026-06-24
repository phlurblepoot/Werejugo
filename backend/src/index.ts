import { mkdir } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { mapSetRoutes } from "./routes/mapsets.js";
import { fileRoutes } from "./routes/files.js";
import { linkRoutes } from "./routes/links.js";
import { mediaRoutes } from "./routes/media.js";
import { mediaSuggestRoutes } from "./routes/media-suggest.js";
import { visitRoutes } from "./routes/visits.js";
import { themeRoutes } from "./routes/themes.js";
import { uploadRoutes } from "./routes/uploads.js";
import { lookupRoutes } from "./routes/lookup.js";
import { tripRoutes } from "./routes/trips.js";
import { itineraryRoutes } from "./routes/itinerary.js";
import { blackoutRoutes } from "./routes/blackouts.js";
import { statsRoutes } from "./routes/stats.js";
import { exifRoutes } from "./routes/exif.js";
import { importRoutes } from "./routes/import.js";
import { exportRoutes } from "./routes/export.js";
import { backupRoutes } from "./routes/backup.js";
import { shareRoutes } from "./routes/share.js";
import { settingsRoutes } from "./routes/settings.js";
import { peopleRoutes } from "./routes/people.js";
import { relationRoutes } from "./routes/relations.js";
import { searchRoutes } from "./routes/search.js";
import { documentRoutes } from "./routes/documents.js";
import { packingRoutes } from "./routes/packing.js";

export async function buildApp(): Promise<FastifyInstance> {
  await mkdir(config.uploadsDir, { recursive: true });
  await mkdir(config.storageDir, { recursive: true });

  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  await app.register(cors, {
    origin: config.corsOrigin.length ? config.corsOrigin : true,
    credentials: true,
  });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: config.jwtExpiresIn } });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(fastifyStatic, { root: config.uploadsDir, prefix: "/uploads/" });

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(mapSetRoutes);
  await app.register(fileRoutes);
  await app.register(linkRoutes);
  await app.register(mediaRoutes);
  await app.register(mediaSuggestRoutes);
  await app.register(visitRoutes);
  await app.register(themeRoutes);
  await app.register(uploadRoutes);
  await app.register(lookupRoutes);
  await app.register(tripRoutes);
  await app.register(itineraryRoutes);
  await app.register(blackoutRoutes);
  await app.register(statsRoutes);
  await app.register(exifRoutes);
  await app.register(importRoutes);
  await app.register(exportRoutes);
  await app.register(backupRoutes);
  await app.register(shareRoutes);
  await app.register(settingsRoutes);
  await app.register(peopleRoutes);
  await app.register(relationRoutes);
  await app.register(searchRoutes);
  await app.register(documentRoutes);
  await app.register(packingRoutes);

  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ host: "0.0.0.0", port: config.port });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
