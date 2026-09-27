import { randomBytes } from "node:crypto";
import { link, mkdir, open, rm, unlink, access } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
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

/** Every family's files live in their own folder, so no path is ever shared. */
export const familyDir = (familyId: string): string => `families/${familyId}`;

/** Relative directory where a document file belongs. */
export function documentDirFor(
  familyId: string,
  trip: { tripName: string; tripStart: string | null } | null,
  person: { personName: string } | null,
): string {
  if (trip) return `${familyDir(familyId)}/trips/${tripSlug(trip.tripName, trip.tripStart)}/documents`;
  if (person) return `${familyDir(familyId)}/people/${slugify(person.personName)}`;
  return `${familyDir(familyId)}/loose/documents`;
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

/**
 * A stored file's name: the original name, readable, plus a random suffix so a
 * path is never reused — not even after the file is deleted — and an old signed
 * URL can never show a newer file. "Sunset Photo.PNG" → "sunset-photo-3f9a1c2e.png".
 */
function storedName(originalName: string, stem?: string): string {
  const ext = extname(originalName).toLowerCase();
  return `${stem ?? slugify(basename(originalName, extname(originalName)))}-${randomBytes(4).toString("hex")}${ext}`;
}

const isExists = (err: unknown) => (err as NodeJS.ErrnoException)?.code === "EEXIST";

/** Create a brand-new file in relDir (exclusively: never overwrites). */
async function createStored(relDir: string, originalName: string) {
  await mkdir(absStoragePath(relDir), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    const relPath = join(relDir, storedName(originalName));
    try {
      return { relPath, handle: await open(absStoragePath(relPath), "wx") };
    } catch (err) {
      if (!isExists(err) || attempt >= 5) throw err;
    }
  }
}

/** Stream into a new stored file; a failed upload leaves nothing behind. */
async function writeStored(relDir: string, originalName: string, data: NodeJS.ReadableStream): Promise<string> {
  const { relPath, handle } = await createStored(relDir, originalName);
  try {
    await pipeline(data, handle.createWriteStream());
  } catch (err) {
    await rm(absStoragePath(relPath), { force: true });
    throw err;
  } finally {
    await handle.close().catch(() => {});
  }
  return relPath;
}

/** Move a stored file into relDir (never overwriting); returns the new rel path. */
export async function moveStored(relPath: string, relDir: string): Promise<string> {
  await mkdir(absStoragePath(relDir), { recursive: true });
  let destRel = join(relDir, basename(relPath));
  for (let attempt = 0; ; attempt++) {
    try {
      // link + unlink instead of rename: link refuses to replace an existing file.
      await link(absStoragePath(relPath), absStoragePath(destRel));
      break;
    } catch (err) {
      if (!isExists(err) || attempt >= 5) throw err;
      destRel = join(relDir, storedName(relPath, slugify(basename(relPath, extname(relPath)))));
    }
  }
  await unlink(absStoragePath(relPath));
  return destRel;
}

/** Remove a family's whole storage folder (after the family is deleted). */
export async function deleteFamilyFiles(familyId: string): Promise<void> {
  await rm(absStoragePath(familyDir(familyId)), { recursive: true, force: true });
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

const DOC_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".doc", ".docx"]);

/** Stream a document file (PDF/image/doc) into relDir. No thumbnail. */
export async function saveDocumentUpload(
  part: { filename: string; file: NodeJS.ReadableStream },
  relDir: string,
): Promise<{ relPath: string; originalName: string }> {
  const ext = extname(part.filename).toLowerCase();
  if (!DOC_EXT.has(ext)) throw new Error("UNSUPPORTED_TYPE");
  const relPath = await writeStored(relDir, part.filename, part.file);
  return { relPath, originalName: part.filename };
}
