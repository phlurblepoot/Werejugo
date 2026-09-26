import { createHmac } from "node:crypto";

/** Values that have shipped as defaults in docs/compose files — never valid in production. */
const PLACEHOLDERS = new Set([
  "please-change-this-to-a-long-random-secret",
  "change-me-in-production",
  "change-me",
  "changeme",
  "secret",
]);
const MIN_LENGTH = 32;
const DEV_FALLBACK = "werejugo-development-only-secret-do-not-use-in-production";
const HOW = "Generate one with: openssl rand -hex 32";

export interface Secrets {
  jwtSecret: string;
  fileSigningSecret: string;
  warnings: string[];
}

function problemWith(secret: string | undefined): string | null {
  if (!secret) return "JWT_SECRET is not set";
  if (PLACEHOLDERS.has(secret)) return "JWT_SECRET is still a placeholder value";
  if (secret.length < MIN_LENGTH) return `JWT_SECRET is shorter than ${MIN_LENGTH} characters`;
  return null;
}

/**
 * Resolve the signing secrets. In production a missing, placeholder or short
 * JWT_SECRET is fatal (anyone could forge logins and file links); elsewhere it
 * only warns so tests and local development keep working.
 */
export function resolveSecrets(env: Record<string, string | undefined>): Secrets {
  const warnings: string[] = [];
  const problem = problemWith(env.JWT_SECRET);
  if (problem && env.NODE_ENV === "production") {
    throw new Error(`${problem}. Set a random value of at least ${MIN_LENGTH} characters. ${HOW}`);
  }
  if (problem) warnings.push(`${problem} — fine for development, but never in production. ${HOW}`);
  const jwtSecret = env.JWT_SECRET || DEV_FALLBACK;

  // Signed file URLs use their own key, derived from the JWT secret unless one
  // is supplied, so the raw login-signing secret never signs anything else.
  const fileSigningSecret =
    env.FILE_SIGNING_SECRET || createHmac("sha256", jwtSecret).update("werejugo:file-signing").digest("hex");

  return { jwtSecret, fileSigningSecret, warnings };
}
