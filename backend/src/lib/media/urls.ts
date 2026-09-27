import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../config.js";
import type { MediaSize } from "../immich/client.js";

/**
 * Signed links to a photo or video, served by Werejugo from Immich
 * (`GET /api/m/:id/:size`). The expiry is rounded up to a 6-hour boundary at
 * least 24 hours away, so a photo keeps the same URL for hours and browsers can
 * cache it; a link is only ever made for media the viewer may see.
 */
export const MEDIA_SIZES = ["thumbnail", "preview", "original", "video"] as const satisfies readonly MediaSize[];
const MIN_TTL_S = 24 * 3600;
const BUCKET_S = 6 * 3600;

const sign = (id: string, size: MediaSize, e: number) =>
  createHmac("sha256", config.fileSigningSecret).update(`media:${id}:${size}:${e}`).digest("base64url");

export function signMediaUrl(id: string, size: MediaSize, nowMs = Date.now()): string {
  const e = Math.ceil((nowMs / 1000 + MIN_TTL_S) / BUCKET_S) * BUCKET_S;
  return `/api/m/${id}/${size}?e=${e}&s=${sign(id, size, e)}`;
}

/** Seconds until the link expires, or null if it isn't valid. */
export function verifyMediaSig(id: string, size: MediaSize, e: string | undefined, s: string | undefined, nowMs = Date.now()): number | null {
  if (!e || !s || !/^\d{1,12}$/.test(e)) return null;
  const left = Number(e) - Math.floor(nowMs / 1000);
  if (left <= 0) return null;
  const want = Buffer.from(sign(id, size, Number(e)));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got) ? left : null;
}

/** The URLs a media DTO carries. */
export function mediaUrls(r: { id: string; kind: string }) {
  return {
    thumbUrl: signMediaUrl(r.id, "thumbnail"),
    url: signMediaUrl(r.id, "preview"),
    originalUrl: signMediaUrl(r.id, "original"),
    videoUrl: r.kind === "video" ? signMediaUrl(r.id, "video") : null,
  };
}
