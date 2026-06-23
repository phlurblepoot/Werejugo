import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
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

test("uniqueName avoids collisions within a directory", async () => {
  const { uniqueName } = await import("./storage.js");
  await mkdir(join(dir, "loose/2024"), { recursive: true });
  await writeFile(join(dir, "loose/2024/photo.jpg"), "a");
  expect(await uniqueName("loose/2024", "photo.jpg")).toBe("photo-2.jpg");
  expect(await uniqueName("loose/2024", "fresh.jpg")).toBe("fresh.jpg");
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
