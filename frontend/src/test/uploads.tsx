import type { ReactNode } from "react";
import { vi } from "vitest";
import type { MediaDto } from "../api/client";
import { UploadManager, type Transport } from "../lib/uploads/manager";
import { UploadsContext } from "../lib/uploads/UploadsProvider";

/**
 * An upload manager whose "server" takes every file in one piece and adds it
 * at once. `media(name)` decides what each file becomes.
 */
export function fakeUploads(media: (name: string, n: number) => MediaDto & { duplicate?: boolean } = (_name, n) => ({ id: `m${n}`, kind: "image", url: "/p", thumbUrl: "/t", caption: "" })) {
  let n = 0;
  const made = new Map<string, { name: string; size: number; result: MediaDto & { duplicate?: boolean } }>();
  const transport: Transport = {
    create: vi.fn(async (b) => {
      const id = `up${++n}`;
      made.set(id, { name: b.filename, size: b.size, result: media(b.filename, n) });
      return { id, filename: b.filename, size: b.size, offset: 0, state: "receiving" as const, duplicate: false, error: null, canRetry: false, media: null, chunkSize: 8 * 1024 * 1024 };
    }),
    putChunk: vi.fn(async (id) => ({ offset: made.get(id)!.size, state: "processing" as const })),
    get: vi.fn(async (id) => {
      const u = made.get(id)!;
      const { duplicate = false, ...m } = u.result;
      return { id, filename: u.name, size: u.size, offset: u.size, state: "done" as const, duplicate, error: null, canRetry: false, media: m };
    }),
    list: vi.fn(async () => ({ items: [] })),
    retry: vi.fn(),
    cancel: vi.fn(async () => {}),
  };
  const resume = { get: () => null, set: () => {}, remove: () => {} };
  const manager = new UploadManager({ transport, resume, sleep: () => Promise.resolve() });
  return { manager, transport };
}

export function withUploads(ui: ReactNode, manager: UploadManager = fakeUploads().manager) {
  return <UploadsContext.Provider value={manager}>{ui}</UploadsContext.Provider>;
}
