import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink, access } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { config } from "../config.js";

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/['‘’]/g, "")           // drop apostrophes so "Joe's" -> "joes"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "untitled";
}

export function tripSlug(name: string, startDate: string | null): string {
  const base = slugify(name);
  if (!startDate) return base;
  const year = startDate.slice(0, 4);
  return `${year}-${base}`;
}

export interface TripFolderInfo {
  name: string;
  startDate: string | null;
}

/** Relative directory (under storageDir) where a media file belongs. */
export function mediaDirFor(trip: TripFolderInfo | null, takenAt: Date | null): string {
  if (trip) return `trips/${tripSlug(trip.name, trip.startDate)}/photos`;
  const year = takenAt && !isNaN(takenAt.getTime()) ? String(takenAt.getFullYear()) : "unknown";
  return `loose/${year}`;
}

/** Relative directory where a document file belongs. */
export function documentDirFor(
  trip: { tripName: string; tripStart: string | null } | null,
  person: { personName: string } | null,
): string {
  if (trip) return `trips/${tripSlug(trip.tripName, trip.tripStart)}/documents`;
  if (person) return `people/${slugify(person.personName)}`;
  return "loose/documents";
}

/** Absolute path for a relative storage path. */
export function absStoragePath(relPath: string): string {
  return join(config.storageDir, relPath);
}

async function exists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

/** A collision-free filename within relDir, derived from the original name. */
export async function uniqueName(relDir: string, originalName: string): Promise<string> {
  const ext = extname(originalName).toLowerCase();
  const stem = slugify(basename(originalName, ext)) || "file";
  let candidate = `${stem}${ext}`;
  let n = 2;
  while (await exists(absStoragePath(join(relDir, candidate)))) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

/** Move a stored file into relDir (de-duping its name); returns the new rel path. */
export async function moveStored(relPath: string, relDir: string): Promise<string> {
  const name = await uniqueName(relDir, basename(relPath));
  const destRel = join(relDir, name);
  await mkdir(absStoragePath(relDir), { recursive: true });
  await rename(absStoragePath(relPath), absStoragePath(destRel));
  return destRel;
}

/** Best-effort delete of a stored file. */
export async function deleteStored(relPath: string | null): Promise<void> {
  if (!relPath) return;
  try {
    await unlink(absStoragePath(relPath));
  } catch {
    /* already gone */
  }
}

export { exists as storedExists };

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".ogg", ".wav", ".aac"]);

export type MediaKind = "image" | "video" | "audio";

function kindForExt(ext: string): MediaKind {
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "image";
}

export interface SavedMedia {
  relPath: string;
  thumbRelPath: string | null;
  kind: MediaKind;
  width: number | null;
  height: number | null;
}

/** Stream an upload into relDir, generate a thumbnail for raster images. */
export async function saveMediaUpload(
  part: { filename: string; file: NodeJS.ReadableStream },
  relDir: string,
): Promise<SavedMedia> {
  const ext = extname(part.filename).toLowerCase();
  if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext) && !AUDIO_EXT.has(ext)) {
    throw new Error("UNSUPPORTED_TYPE");
  }
  const name = await uniqueName(relDir, part.filename);
  const relPath = join(relDir, name);
  await mkdir(absStoragePath(relDir), { recursive: true });
  await pipeline(part.file, createWriteStream(absStoragePath(relPath)));

  const kind = kindForExt(ext);
  let thumbRelPath: string | null = null;
  let width: number | null = null;
  let height: number | null = null;

  if (kind === "image" && ext !== ".gif") {
    try {
      const meta = await sharp(absStoragePath(relPath)).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      const thumbName = `${basename(name, ext)}.thumb.jpg`;
      const thumbRel = join(relDir, thumbName);
      await sharp(absStoragePath(relPath))
        .rotate()
        .resize(400, 400, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(absStoragePath(thumbRel));
      thumbRelPath = thumbRel;
    } catch {
      thumbRelPath = null;
    }
  }
  return { relPath, thumbRelPath, kind, width, height };
}

const DOC_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".doc", ".docx"]);

/** Stream a document file (PDF/image/doc) into relDir. No thumbnail. */
export async function saveDocumentUpload(
  part: { filename: string; file: NodeJS.ReadableStream },
  relDir: string,
): Promise<{ relPath: string; originalName: string }> {
  const ext = extname(part.filename).toLowerCase();
  if (!DOC_EXT.has(ext)) throw new Error("UNSUPPORTED_TYPE");
  const name = await uniqueName(relDir, part.filename);
  const relPath = join(relDir, name);
  await mkdir(absStoragePath(relDir), { recursive: true });
  await pipeline(part.file, createWriteStream(absStoragePath(relPath)));
  return { relPath, originalName: part.filename };
}
