import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { customAlphabet } from "nanoid";
import { config } from "../config.js";

const fileId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 16);
export const ALLOWED_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"]);

/** Stream an uploaded file part to the uploads dir. Returns its public `/uploads/...` URL. */
export async function saveUpload(part: {
  filename: string;
  file: NodeJS.ReadableStream;
}): Promise<string> {
  const ext = extname(part.filename).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) throw new Error("UNSUPPORTED_TYPE");
  await mkdir(config.uploadsDir, { recursive: true });
  const name = `${fileId()}${ext}`;
  await pipeline(part.file, createWriteStream(join(config.uploadsDir, name)));
  return `/uploads/${name}`;
}

/** Remove a previously uploaded file by its public URL. Best-effort. */
export async function deleteUploadFile(url: string): Promise<void> {
  if (!url.startsWith("/uploads/")) return;
  try {
    await unlink(join(config.uploadsDir, basename(url)));
  } catch {
    /* already gone — ignore */
  }
}
