import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function signPath(relPath: string, exp: string): string {
  return createHmac("sha256", config.jwtSecret).update(`${relPath}:${exp}`).digest("hex");
}

/** Build a signed, time-limited URL the browser can load directly in <img>. */
export function signFileUrl(relPath: string): string {
  const exp = String(Date.now() + TTL_MS);
  const sig = signPath(relPath, exp);
  const encoded = relPath.split("/").map(encodeURIComponent).join("/");
  return `/api/files/${encoded}?exp=${exp}&sig=${sig}`;
}

export function verifyFileToken(relPath: string, exp: string, sig: string): boolean {
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = signPath(relPath, exp);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
