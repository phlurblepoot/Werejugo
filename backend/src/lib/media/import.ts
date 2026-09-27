import { query } from "../../db/pool.js";
import { HttpError } from "../errors.js";
import { extractExif } from "../exif.js";
import { immich, type ImmichConn } from "../immich/client.js";
import { fieldsFromAsset, upsertAsset, type AssetFields } from "./assets.js";

/**
 * Handing one file to the family's Immich account and keeping a reference to
 * it. Used by the single-request upload (POST /api/media) and by the hand-off
 * of a chunked upload (lib/media/uploads.ts).
 */

export const NO_IMMICH = "Photos need Immich. Ask the server admin to connect your family (Admin → Immich).";

const MEDIA_NAME = /\.(jpe?g|png|heic|heif|avif|webp|gif|tiff?|dng|cr2|cr3|nef|arw|raf|orf|rw2|mp4|mov|m4v|3gp|avi|mkv|webm|mts)$/i;

/** A photo or video, by type or by name (Immich makes the final call). Never SVG. */
export function isMediaFile(name: string, mime: string): boolean {
  if (/svg/i.test(mime) || /\.svg$/i.test(name)) return false;
  const top = mime.split("/")[0];
  return top === "image" || top === "video" || MEDIA_NAME.test(name);
}

export interface ImportInput {
  familyId: string;
  /** Who added it (null: nobody in particular). */
  userId: string | null;
  /** The bytes: in memory, or backed by a file (`fs.openAsBlob`), which is streamed. */
  file: Blob;
  filename: string;
  /** A path (only the start is read) or the bytes, for the date and place right away. */
  exifSource: string | Buffer;
  /** The file's own modification time, used when it has no EXIF date. */
  fileModifiedAt?: string | null;
  caption?: string;
}

export interface ImportResult {
  mediaId: string;
  /** The file was already in the family's library (its existing photo is returned). */
  duplicate: boolean;
}

export async function importToImmich(conn: ImmichConn, input: ImportInput): Promise<ImportResult> {
  // The date and place now, for suggestions right away; Immich reads its own a
  // few seconds later and the library sync picks that up.
  const exif = await extractExif(input.exifSource);
  const when = exif.takenAt ?? input.fileModifiedAt ?? new Date().toISOString();
  const up = await immich.uploadAsset(conn, input.file, {
    filename: input.filename, fileCreatedAt: when, fileModifiedAt: input.fileModifiedAt ?? when,
  });
  const duplicate = up.status === "duplicate";

  let asset = await immich.getAsset(conn, up.id).catch(() => null);
  // The same file again after it was deleted: bring it back from Immich's trash.
  if (duplicate && asset?.isTrashed) {
    await immich.restoreAssets(conn, [up.id]);
    asset = await immich.getAsset(conn, up.id).catch(() => null);
  }

  const mime = input.file.type;
  const fields: AssetFields = (asset && fieldsFromAsset(asset)) ?? {
    kind: mime.startsWith("video/") ? "video" : "image", originalName: input.filename, mime,
    bytes: input.file.size, durationMs: null, thumbhash: null, takenAt: null, lat: null, lng: null, width: null, height: null,
    caption: null, city: null, state: null, country: null, updatedAt: null,
  };
  const saved = await upsertAsset(input.familyId, up.id, fields, {
    createdBy: duplicate ? null : input.userId, fallback: { takenAt: exif.takenAt, lat: exif.lat, lng: exif.lng },
  });
  if (!saved) throw new HttpError(409, "That photo belongs to another family's Immich account");

  if (input.caption && !duplicate) {
    await immich.setDescription(conn, up.id, input.caption);
    await query("UPDATE media SET caption = $2 WHERE id = $1", [saved.id, input.caption]);
  }
  return { mediaId: saved.id, duplicate };
}
