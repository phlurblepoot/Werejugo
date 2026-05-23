function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const config = {
  databaseUrl: required("DATABASE_URL", "postgres://werejugo:change-me-in-production@localhost:5432/werejugo"),
  jwtSecret: required("JWT_SECRET", "please-change-this-to-a-long-random-secret"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "30d",
  port: Number(process.env.BACKEND_PORT ?? 4000),
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:8080")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  uploadsDir: process.env.UPLOADS_DIR ?? "/app/uploads",
  aerodataboxKey: process.env.AERODATABOX_RAPIDAPI_KEY ?? "",
  nominatimUrl: process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org",
  nominatimUserAgent: process.env.NOMINATIM_USER_AGENT ?? "Werejugo/0.1",
  cruiseLookupEnabled: (process.env.CRUISE_LOOKUP_ENABLED ?? "true") === "true",
  cruiseUserAgent:
    process.env.CRUISE_USER_AGENT ??
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};
