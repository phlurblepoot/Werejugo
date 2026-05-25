import { createWriteStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { customAlphabet } from "nanoid";
import sharp from "sharp";
import { config } from "../config.js";

const fileId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 16);

export const ALLOWED_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".ogg", ".wav", ".aac"]);
const ALLOWED_MEDIA_EXT = new Set([...ALLOWED_IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT]);

export type MediaType = "image" | "video" | "audio";

function mediaTypeFor(ext: string): MediaType {
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "image";
}

async function writePart(
  part: { filename: string; file: NodeJS.ReadableStream },
  allowed: Set<string>,
): Promise<{ name: string; url: string; path: string; ext: string }> {
  const ext = extname(part.filename).toLowerCase();
  if (!allowed.has(ext)) throw new Error("UNSUPPORTED_TYPE");
  await mkdir(config.uploadsDir, { recursive: true });
  const name = `${fileId()}${ext}`;
  const path = join(config.uploadsDir, name);
  await pipeline(part.file, createWriteStream(path));
  return { name, url: `/uploads/${name}`, path, ext };
}

/** Stream an image upload (icons, overlays). Returns its public `/uploads/...` URL. */
export async function saveUpload(part: {
  filename: string;
  file: NodeJS.ReadableStream;
}): Promise<string> {
  const { url } = await writePart(part, ALLOWED_IMAGE_EXT);
  return url;
}

/** Save an item attachment (image/video/audio) plus a thumbnail for raster images. */
export async function savePhoto(part: {
  filename: string;
  file: NodeJS.ReadableStream;
}): Promise<{ url: string; thumbUrl: string | null; mediaType: MediaType }> {
  const { url, path, ext } = await writePart(part, ALLOWED_MEDIA_EXT);
  const mediaType = mediaTypeFor(ext);
  let thumbUrl: string | null = null;
  if (mediaType === "image" && ext !== ".svg" && ext !== ".gif") {
    try {
      const thumbName = `${basename(url).replace(ext, "")}_thumb.jpg`;
      await sharp(path)
        .rotate() // respect EXIF orientation
        .resize(400, 400, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(join(config.uploadsDir, thumbName));
      thumbUrl = `/uploads/${thumbName}`;
    } catch {
      thumbUrl = null; // fall back to the full image
    }
  } else if (ext === ".svg") {
    thumbUrl = url;
  }
  return { url, thumbUrl, mediaType };
}

function extForContentType(ct: string): string | null {
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("svg")) return ".svg";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  return null;
}

/** Download an external image into uploads (+ thumbnail). Caller must validate the host. */
export async function downloadImage(
  srcUrl: string,
): Promise<{ url: string; thumbUrl: string | null; mediaType: MediaType } | null> {
  let res: Response;
  try {
    res = await fetch(srcUrl, { headers: { "User-Agent": config.cruiseUserAgent } });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const ext = extForContentType(res.headers.get("content-type") ?? "");
  if (!ext) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > 15 * 1024 * 1024) return null;

  await mkdir(config.uploadsDir, { recursive: true });
  const name = `${fileId()}${ext}`;
  await writeFile(join(config.uploadsDir, name), buf);

  let thumbUrl: string | null = null;
  if (ext !== ".svg" && ext !== ".gif") {
    try {
      // Preserve transparency for PNG/WebP (logos); JPEG otherwise.
      const thumbExt = ext === ".png" ? ".png" : ext === ".webp" ? ".webp" : ".jpg";
      const thumbName = `${name.replace(ext, "")}_thumb${thumbExt}`;
      let pipe = sharp(buf).rotate().resize(400, 400, { fit: "inside", withoutEnlargement: true });
      pipe = thumbExt === ".png" ? pipe.png() : thumbExt === ".webp" ? pipe.webp() : pipe.jpeg({ quality: 80 });
      await pipe.toFile(join(config.uploadsDir, thumbName));
      thumbUrl = `/uploads/${thumbName}`;
    } catch {
      thumbUrl = null;
    }
  } else if (ext === ".svg") {
    thumbUrl = `/uploads/${name}`;
  }
  return { url: `/uploads/${name}`, thumbUrl, mediaType: "image" };
}

/** Remove a previously uploaded file by its public URL. Best-effort. */
export async function deleteUploadFile(url: string | null): Promise<void> {
  if (!url || !url.startsWith("/uploads/")) return;
  try {
    await unlink(join(config.uploadsDir, basename(url)));
  } catch {
    /* already gone — ignore */
  }
}
