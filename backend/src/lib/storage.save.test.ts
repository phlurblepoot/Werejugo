import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wj-save-"));
  vi.resetModules();
  process.env.STORAGE_DIR = dir;
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("saveMediaUpload stores an image and a thumbnail", async () => {
  const { saveMediaUpload, absStoragePath } = await import("./storage.js");
  const png = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#fff" },
  }).png().toBuffer();

  const result = await saveMediaUpload(
    { filename: "Sunset Photo.png", file: Readable.from(png) },
    "loose/2024",
  );

  expect(result.kind).toBe("image");
  expect(result.relPath).toBe("loose/2024/sunset-photo.png");
  expect(result.thumbRelPath).toBe("loose/2024/sunset-photo.thumb.jpg");
  expect(existsSync(absStoragePath(result.relPath))).toBe(true);
  expect(existsSync(absStoragePath(result.thumbRelPath!))).toBe(true);
});

test("saveMediaUpload rejects unsupported extensions", async () => {
  const { saveMediaUpload } = await import("./storage.js");
  await expect(
    saveMediaUpload({ filename: "x.exe", file: Readable.from(Buffer.from("x")) }, "loose/2024"),
  ).rejects.toThrow("UNSUPPORTED_TYPE");
});
