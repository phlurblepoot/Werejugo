import { mkdir } from "node:fs/promises";
import Fastify from "fastify";
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

async function main(): Promise<void> {
  await mkdir(config.uploadsDir, { recursive: true });

  const app = Fastify({ logger: true });

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

  await app.listen({ host: "0.0.0.0", port: config.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
