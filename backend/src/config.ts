import { resolveSecrets } from "./lib/secrets.js";

const secrets = resolveSecrets(process.env);

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const config = {
  databaseUrl: required("DATABASE_URL", "postgres://werejugo:change-me-in-production@localhost:5432/werejugo"),
  jwtSecret: secrets.jwtSecret,
  fileSigningSecret: secrets.fileSigningSecret,
  /** Seals stored secrets (Immich keys; document files in 3.3). Optional until Immich is turned on. */
  encryptionKey: process.env.ENCRYPTION_KEY,
  /** Problems worth logging at startup (e.g. a weak secret outside production). */
  startupWarnings: secrets.warnings,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "30d",
  port: Number(process.env.BACKEND_PORT ?? 4000),
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:8080")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  uploadsDir: process.env.UPLOADS_DIR ?? "/app/uploads",
  /** The largest photo or video one upload may be (unfinished uploads wait in UPLOADS_DIR). */
  maxUploadBytes: Math.round(Number(process.env.MAX_UPLOAD_GB || 20) * 1024 ** 3),
  storageDir: process.env.STORAGE_DIR ?? "/app/storage",
  aerodataboxKey: process.env.AERODATABOX_RAPIDAPI_KEY ?? "",
  /** Place search (Photon): the public server, or your own. */
  photonUrl: (process.env.PHOTON_URL || "https://photon.komoot.io").replace(/\/+$/, ""),
  /** Road routes for road trips: any OSRM server. */
  routingUrl: (process.env.ROUTING_URL || "https://routing.openstreetmap.de/routed-car").replace(/\/+$/, ""),
  /** How Werejugo introduces itself to the services it asks (Photon, road routing). */
  userAgent: process.env.WEREJUGO_USER_AGENT || "Werejugo (self-hosted family travel map; https://github.com/phlurblepoot/Werejugo)",
  /** CruiseMapper's address (tests point it at a stand-in). */
  cruiseMapperUrl: (process.env.CRUISEMAPPER_URL || "https://www.cruisemapper.com").replace(/\/+$/, ""),
  cruiseLookupEnabled: (process.env.CRUISE_LOOKUP_ENABLED ?? "true") === "true",
  cruiseUserAgent:
    process.env.CRUISE_USER_AGENT ??
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};
