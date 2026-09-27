import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wj-store-"));
  // Point config.storageDir at the temp dir for this test file.
  vi.resetModules();
  process.env.STORAGE_DIR = dir;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("the same name uploaded twice (even at once) gets two files, never one", async () => {
  const { saveDocumentUpload, absStoragePath } = await import("./storage.js");
  const up = (body: string) => saveDocumentUpload({ filename: "Ticket.pdf", file: Readable.from(Buffer.from(body)) }, "loose/documents");
  const [a, b] = await Promise.all([up("first"), up("second")]);
  expect(a.relPath).not.toBe(b.relPath);
  expect(await readFile(absStoragePath(a.relPath), "utf8")).toBe("first");
  expect(await readFile(absStoragePath(b.relPath), "utf8")).toBe("second");
});

test("a failed upload leaves no partial file", async () => {
  const { saveDocumentUpload } = await import("./storage.js");
  const broken = new Readable({ read() { this.destroy(new Error("connection lost")); } });
  await expect(saveDocumentUpload({ filename: "x.pdf", file: broken }, "loose/documents")).rejects.toThrow("connection lost");
  expect(await readdir(join(dir, "loose/documents"))).toEqual([]);
});

test("moving never overwrites a file already at the destination", async () => {
  const { moveStored, absStoragePath } = await import("./storage.js");
  await mkdir(join(dir, "a"), { recursive: true });
  await mkdir(join(dir, "b"), { recursive: true });
  await writeFile(join(dir, "a/x.jpg"), "mine");
  await writeFile(join(dir, "b/x.jpg"), "already there");
  const moved = await moveStored("a/x.jpg", "b");
  expect(moved).not.toBe("b/x.jpg");
  expect(await readFile(absStoragePath("b/x.jpg"), "utf8")).toBe("already there");
  expect(await readFile(absStoragePath(moved), "utf8")).toBe("mine");
});

test("moveStored relocates a file and returns the new rel path", async () => {
  const { moveStored, absStoragePath } = await import("./storage.js");
  await mkdir(join(dir, "loose/2024"), { recursive: true });
  await writeFile(join(dir, "loose/2024/a.jpg"), "x");
  const newRel = await moveStored("loose/2024/a.jpg", "trips/2024-italy/photos");
  expect(newRel).toBe("trips/2024-italy/photos/a.jpg");
  expect(existsSync(absStoragePath("loose/2024/a.jpg"))).toBe(false);
  expect(await readFile(absStoragePath(newRel), "utf8")).toBe("x");
});
