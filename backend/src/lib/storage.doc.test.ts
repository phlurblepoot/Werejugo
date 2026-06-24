import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "wj-doc-")); vi.resetModules(); process.env.STORAGE_DIR = dir; });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("saves a PDF into the target dir with a readable name", async () => {
  const { saveDocumentUpload, absStoragePath } = await import("./storage.js");
  const r = await saveDocumentUpload({ filename: "Dad Passport.pdf", file: Readable.from(Buffer.from("%PDF-1.4")) }, "people/dad");
  expect(r.relPath).toBe("people/dad/dad-passport.pdf");
  expect(r.originalName).toBe("Dad Passport.pdf");
  expect(existsSync(absStoragePath(r.relPath))).toBe(true);
});

test("rejects an unsupported type", async () => {
  const { saveDocumentUpload } = await import("./storage.js");
  await expect(saveDocumentUpload({ filename: "x.exe", file: Readable.from(Buffer.from("x")) }, "loose/documents"))
    .rejects.toThrow("UNSUPPORTED_TYPE");
});
