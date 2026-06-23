import { join } from "node:path";
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
