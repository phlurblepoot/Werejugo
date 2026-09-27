import { mkdir } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { ephemeralDataDirs } from "./lib/storage-check.js";
import { installErrorHandling } from "./lib/errors.js";
import { authRoutes } from "./routes/auth.js";
import { fileRoutes } from "./routes/files.js";
import { linkRoutes } from "./routes/links.js";
import { mediaRoutes } from "./routes/media.js";
import { mediaSuggestRoutes } from "./routes/media-suggest.js";
import { visitRoutes } from "./routes/visits.js";
import { themeRoutes } from "./routes/themes.js";
import { uploadRoutes } from "./routes/uploads.js";
import { lookupRoutes } from "./routes/lookup.js";
import { tripRoutes } from "./routes/trips.js";
import { tripSharingRoutes } from "./routes/trip-sharing.js";
import { itineraryRoutes } from "./routes/itinerary.js";
import { blackoutRoutes } from "./routes/blackouts.js";
import { statsRoutes } from "./routes/stats.js";
import { exifRoutes } from "./routes/exif.js";
import { importRoutes } from "./routes/import.js";
import { backupRoutes } from "./routes/backup.js";
import { shareRoutes } from "./routes/share.js";
import { settingsRoutes } from "./routes/settings.js";
import { peopleRoutes } from "./routes/people.js";
import { relationRoutes } from "./routes/relations.js";
import { personLinkRoutes } from "./routes/person-links.js";
import { searchRoutes } from "./routes/search.js";
import { documentRoutes } from "./routes/documents.js";
import { packingRoutes } from "./routes/packing.js";
import { inviteRoutes } from "./routes/invites.js";
import { passwordResetRoutes } from "./routes/password-resets.js";
import { accountRoutes } from "./routes/account.js";
import { familyRoutes } from "./routes/family.js";
import { familyExportRoutes } from "./routes/family-export.js";
import { downloadRoutes } from "./routes/downloads.js";
import { adminRoutes } from "./routes/admin.js";
import { adminImmichRoutes, familyImmichRoutes } from "./routes/immich.js";
import { checkServer } from "./lib/immich/provision.js";
import { SUPPORTED_RANGE } from "./lib/immich/version.js";

export interface RegisteredRoute {
  method: string;
  url: string;
}

declare module "fastify" {
  interface FastifyInstance {
    registeredRoutes: RegisteredRoute[];
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  await mkdir(config.uploadsDir, { recursive: true });
  await mkdir(config.storageDir, { recursive: true });

  // trustProxy: requests arrive through nginx (and often cloudflared), so the
  // real client address is in X-Forwarded-For.
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true });
  for (const w of config.startupWarnings) app.log.warn(w);
  for (const w of ephemeralDataDirs([
    { name: "STORAGE_DIR", path: config.storageDir },
    { name: "UPLOADS_DIR", path: config.uploadsDir },
  ])) app.log.error(w);

  await app.register(cors, {
    origin: config.corsOrigin.length ? config.corsOrigin : true,
    credentials: true,
  });
  // Security headers on every response. The app's HTML (and its CSP) is served
  // by nginx; HSTS is left to the TLS terminator (e.g. Cloudflare) so a LAN or
  // plain-HTTP install isn't pinned to HTTPS.
  await app.register(helmet, { contentSecurityPolicy: false, hsts: false });
  // Per-route limits (login/register); keyed on Cloudflare's client IP when
  // present, otherwise the proxied client address.
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => (req.headers["cf-connecting-ip"] as string | undefined) || req.ip,
  });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: config.jwtExpiresIn } });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(fastifyStatic, {
    root: config.uploadsDir,
    prefix: "/uploads/",
    // User-supplied files: never sniffed, never allowed to run script (older
    // installs may still hold SVG uploads).
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    },
  });

  // Before the routes, so the error handler and the id check apply to all of them.
  installErrorHandling(app);

  // Every route, so the tenant-isolation suite can prove it covers them all.
  const routes: RegisteredRoute[] = [];
  app.addHook("onRoute", (r) => {
    for (const method of [r.method].flat()) if (method !== "HEAD") routes.push({ method, url: r.url });
  });
  app.decorate("registeredRoutes", routes);

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(fileRoutes);
  await app.register(linkRoutes);
  await app.register(mediaRoutes);
  await app.register(mediaSuggestRoutes);
  await app.register(visitRoutes);
  await app.register(themeRoutes);
  await app.register(uploadRoutes);
  await app.register(lookupRoutes);
  await app.register(tripRoutes);
  await app.register(tripSharingRoutes);
  await app.register(itineraryRoutes);
  await app.register(blackoutRoutes);
  await app.register(statsRoutes);
  await app.register(exifRoutes);
  await app.register(importRoutes);
  await app.register(backupRoutes);
  await app.register(shareRoutes);
  await app.register(settingsRoutes);
  await app.register(peopleRoutes);
  await app.register(relationRoutes);
  await app.register(personLinkRoutes);
  await app.register(searchRoutes);
  await app.register(documentRoutes);
  await app.register(packingRoutes);
  await app.register(inviteRoutes);
  await app.register(passwordResetRoutes);
  await app.register(accountRoutes);
  await app.register(familyRoutes);
  await app.register(familyExportRoutes);
  await app.register(downloadRoutes);
  await app.register(adminRoutes);
  await app.register(adminImmichRoutes);
  await app.register(familyImmichRoutes);

  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ host: "0.0.0.0", port: config.port });
  // Say whether Immich is there and supported; never stop the server over it.
  checkServer().then((c) => {
    if (!c) return;
    if (!c.ok) app.log.warn(`Immich: ${c.error}`);
    else if (!c.supported) app.log.warn(`Immich ${c.version} isn't a supported version (supported: ${SUPPORTED_RANGE}); things may break`);
    else app.log.info(`Immich ${c.version} connected`);
  }).catch((e) => app.log.warn(`Immich check failed: ${e instanceof Error ? e.message : e}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
