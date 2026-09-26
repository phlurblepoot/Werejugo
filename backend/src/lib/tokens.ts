import { createHash, randomBytes } from "node:crypto";

/** A random, URL-safe one-time token (256 bits). Only its hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A timestamp `days` from now, clamped to a sane range. */
export function expiresInDays(days: number): Date {
  const d = Math.min(Math.max(Math.round(days), 1), 30);
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000);
}
