import type pg from "pg";
import { query } from "../../db/pool.js";
import type { ImmichAsset } from "../immich/client.js";

/**
 * Turning an Immich asset into (or refreshing) a Werejugo media reference.
 * Used by uploads and by the library sync. Photos and videos only; assets
 * Immich hides (the video half of a Live Photo) or locks away are skipped.
 */

type Db = Pick<pg.PoolClient, "query">;

export interface AssetFields {
  kind: "image" | "video";
  originalName: string;
  mime: string;
  bytes: number | null;
  durationMs: number | null;
  thumbhash: string | null;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
  width: number | null;
  height: number | null;
  /** The description, when Immich sent EXIF (otherwise the caption is left alone). */
  caption: string | null;
  updatedAt: string | null;
}

/** "0:00:12.345000" (older Immich) or milliseconds. */
function durationMs(d: unknown): number | null {
  if (typeof d === "number" && Number.isFinite(d) && d > 0) return Math.round(d);
  if (typeof d === "string") {
    const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(d);
    if (m) {
      const ms = Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
      return ms > 0 ? ms : null;
    }
  }
  return null;
}

export function fieldsFromAsset(a: ImmichAsset): AssetFields | null {
  if (a.type !== "IMAGE" && a.type !== "VIDEO") return null;
  if (a.visibility === "hidden" || a.visibility === "locked" || a.isTrashed) return null;
  const x = a.exifInfo;
  const lat = typeof x?.latitude === "number" ? x.latitude : null;
  const lng = typeof x?.longitude === "number" ? x.longitude : null;
  const coords = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  return {
    kind: a.type === "VIDEO" ? "video" : "image",
    originalName: a.originalFileName ?? "",
    mime: a.originalMimeType ?? "",
    bytes: typeof x?.fileSizeInByte === "number" ? x.fileSizeInByte : null,
    durationMs: a.type === "VIDEO" ? durationMs(a.duration) : null,
    thumbhash: a.thumbhash ?? null,
    takenAt: x?.dateTimeOriginal ?? a.fileCreatedAt ?? null,
    lat: coords ? lat : null,
    lng: coords ? lng : null,
    width: a.width ?? x?.exifImageWidth ?? null,
    height: a.height ?? x?.exifImageHeight ?? null,
    caption: x ? (x.description ?? "") : null,
    updatedAt: a.updatedAt ?? null,
  };
}

/**
 * Insert or refresh the reference for one asset. Known values aren't replaced
 * by missing ones (Immich fills in dates and places a few seconds after an
 * upload). A reference never moves to another family.
 */
export async function upsertAsset(
  familyId: string, assetId: string, f: AssetFields,
  opts: { createdBy?: string | null; fallback?: { takenAt?: string | null; lat?: number | null; lng?: number | null }; db?: Db } = {},
): Promise<{ id: string; inserted: boolean } | null> {
  const takenAt = f.takenAt ?? opts.fallback?.takenAt ?? null;
  const lat = f.lat ?? opts.fallback?.lat ?? null;
  const lng = f.lng ?? opts.fallback?.lng ?? null;
  const run = opts.db ? opts.db.query.bind(opts.db) : query;
  const { rows } = await run<{ id: string; inserted: boolean }>(
    `INSERT INTO media (family_id, immich_asset_id, kind, original_name, mime, bytes, duration_ms, thumbhash, taken_at, geom,
                        width, height, caption, immich_updated_at, synced_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             CASE WHEN $10::float8 IS NULL OR $11::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($11, $10), 4326) END,
             $12, $13, COALESCE($14, ''), $15, now(), $16)
     ON CONFLICT (immich_asset_id) DO UPDATE SET
       kind = EXCLUDED.kind, original_name = EXCLUDED.original_name, mime = EXCLUDED.mime,
       bytes = COALESCE(EXCLUDED.bytes, media.bytes), duration_ms = COALESCE(EXCLUDED.duration_ms, media.duration_ms),
       thumbhash = COALESCE(EXCLUDED.thumbhash, media.thumbhash),
       taken_at = COALESCE(EXCLUDED.taken_at, media.taken_at), geom = COALESCE(EXCLUDED.geom, media.geom),
       width = COALESCE(EXCLUDED.width, media.width), height = COALESCE(EXCLUDED.height, media.height),
       caption = CASE WHEN $14::text IS NULL THEN media.caption ELSE EXCLUDED.caption END,
       immich_updated_at = EXCLUDED.immich_updated_at, synced_at = now()
     WHERE media.family_id = EXCLUDED.family_id
     RETURNING id, (xmax = 0) AS inserted`,
    [familyId, assetId, f.kind, f.originalName, f.mime, f.bytes, f.durationMs, f.thumbhash, takenAt, lat, lng,
     f.width, f.height, f.caption, f.updatedAt, opts.createdBy ?? null],
  );
  return rows[0] ?? null;
}
