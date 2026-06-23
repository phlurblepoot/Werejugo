import { mkdir } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { mapSetRoutes } from "./routes/mapsets.js";
import { itemRoutes } from "./routes/items.js";
import { themeRoutes } from "./routes/themes.js";
import { uploadRoutes } from "./routes/uploads.js";
import { lookupRoutes } from "./routes/lookup.js";
import { tripRoutes } from "./routes/trips.js";
import { statsRoutes } from "./routes/stats.js";
import { exifRoutes } from "./routes/exif.js";
import { importRoutes } from "./routes/import.js";
import { exportRoutes } from "./routes/export.js";
import { shareRoutes } from "./routes/share.js";
import { settingsRoutes } from "./routes/settings.js";

export async function buildApp(): Promise<FastifyInstance> {
  await mkdir(config.uploadsDir, { recursive: true });

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
  await app.register(itemRoutes);
  await app.register(themeRoutes);
  await app.register(uploadRoutes);
  await app.register(lookupRoutes);
  await app.register(tripRoutes);
  await app.register(statsRoutes);
  await app.register(exifRoutes);
  await app.register(importRoutes);
  await app.register(exportRoutes);
  await app.register(shareRoutes);
  await app.register(settingsRoutes);

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
