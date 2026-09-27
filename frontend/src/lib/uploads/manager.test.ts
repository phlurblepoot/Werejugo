import { describe, expect, test, vi } from "vitest";
import { ChunkError, fingerprint, UploadManager, type ResumeStore, type ServerUpload, type Transport } from "./manager";

/** jsdom's Blob has no arrayBuffer(); FileReader works. */
const readBytes = (b: Blob) => new Promise<Uint8Array>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
  r.onerror = () => reject(r.error);
  r.readAsArrayBuffer(b);
});

/** A server that keeps uploads in memory, with hooks to make things go wrong. */
function fakeServer(opts: { chunkSize?: number } = {}) {
  const uploads = new Map<string, ServerUpload & { bytes: number[]; linkTo?: string; caption?: string }>();
  let n = 0;
  const failures: Array<(id: string, offset: number) => ChunkError | null> = [];
  const handoff = { result: "done" as "done" | "failed", error: null as string | null, canRetry: false, duplicate: false };
  const puts: Array<{ id: string; offset: number; size: number }> = [];
  const t: Transport = {
    create: vi.fn(async (b) => {
      const id = `up${++n}`;
      const u = { id, filename: b.filename, size: b.size, offset: 0, state: "receiving" as const, duplicate: false, error: null, canRetry: false, media: null, bytes: [], linkTo: b.linkTo, caption: b.caption };
      uploads.set(id, u);
      return { ...u, chunkSize: opts.chunkSize ?? 4 };
    }),
    get: vi.fn(async (id) => {
      const u = uploads.get(id);
      if (!u) throw Object.assign(new Error("Upload not found"), { status: 404 });
      return { ...u };
    }),
    list: vi.fn(async () => ({ items: [...uploads.values()].map((u) => ({ ...u })) })),
    putChunk: vi.fn(async (id, offset, piece, onProgress) => {
      const u = uploads.get(id);
      if (!u) throw new ChunkError(404, "Upload not found");
      for (const f of failures.splice(0, 1)) {
        const e = f(id, offset);
        if (e) throw e;
      }
      if (offset !== u.offset) throw new ChunkError(409, "continue from there", u.offset);
      const bytes = await readBytes(piece);
      onProgress(bytes.length);
      puts.push({ id, offset, size: bytes.length });
      u.bytes.push(...bytes);
      u.offset += bytes.length;
      if (u.offset === u.size) {
        u.state = "processing";
        // The hand-off finishes by the next poll.
        queueMicrotask(() => {
          u.state = handoff.result;
          u.error = handoff.error;
          u.canRetry = handoff.canRetry;
          u.duplicate = handoff.duplicate;
          if (handoff.result === "done") u.media = { id: `media-${id}`, kind: "image", url: "/p", thumbUrl: "/t", caption: u.caption ?? "" };
        });
      }
      return { offset: u.offset, state: u.state };
    }),
    retry: vi.fn(async (id) => {
      const u = uploads.get(id)!;
      u.state = "done";
      u.error = null;
      u.media = { id: `media-${id}`, kind: "image", url: "/p", thumbUrl: "/t", caption: "" };
      return { ...u, state: "processing" as const };
    }),
    cancel: vi.fn(async (id) => { uploads.delete(id); }),
  };
  return { t, uploads, failures, handoff, puts };
}

function memoryResume(): ResumeStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => { map.set(k, v); }, remove: (k) => { map.delete(k); } };
}

const file = (text: string, name = "a.jpg") => new File([text], name, { type: "image/jpeg", lastModified: 1700000000000 });
const noSleep = () => Promise.resolve();

function setup(o: { chunkSize?: number; concurrency?: number } = {}) {
  const server = fakeServer(o);
  const resume = memoryResume();
  const onFinished = vi.fn();
  const m = new UploadManager({ transport: server.t, resume, onFinished, sleep: noSleep, concurrency: o.concurrency });
  return { m, server, resume, onFinished };
}

describe("UploadManager", () => {
  test("sends a file in pieces, waits for Immich, and reports the photo", async () => {
    const { m, server, onFinished } = setup({ chunkSize: 4 });
    const onEach = vi.fn();
    const { done } = m.add([{ file: file("0123456789"), caption: "Hi" }], { linkTo: "visit:v1", linkRole: "appears_in", onEach });
    const [t] = await done;
    expect(t).toMatchObject({ state: "done", sent: 10, duplicate: false, media: { id: "media-up1", caption: "Hi" } });
    expect(server.puts.map((p) => [p.offset, p.size])).toEqual([[0, 4], [4, 4], [8, 2]]);
    expect(server.uploads.get("up1")).toMatchObject({ linkTo: "visit:v1", caption: "Hi" });
    expect(String.fromCharCode(...server.uploads.get("up1")!.bytes)).toBe("0123456789");
    expect(onEach).toHaveBeenCalledWith(expect.objectContaining({ key: t.key, state: "done" }));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  test("a dropped piece is sent again; after too many the file fails and Retry continues where it stopped", async () => {
    const { m, server } = setup({ chunkSize: 4 });
    const dropped = () => new ChunkError(0, "The connection dropped");
    server.failures.push(() => null, dropped); // the second piece drops once
    let [t] = await m.add([file("0123456789")]).done;
    expect(t.state).toBe("done");
    expect(server.puts.map((p) => p.offset)).toEqual([0, 4, 8]);

    // Every attempt fails: 1 try + 6 retries, then "failed" with Retry.
    server.failures.push(...Array.from({ length: 7 }, () => dropped));
    [t] = await m.add([file("abcdefghij", "b.jpg")]).done;
    expect(t).toMatchObject({ state: "failed", canRetry: true, sent: 0 });
    expect(t.error).toMatch(/keeps dropping/);
    const before = server.puts.length;
    await m.retry(t.key);
    await vi.waitFor(() => expect(m.snapshot().find((x) => x.key === t.key)?.state).toBe("done"));
    expect(server.puts.slice(before).map((p) => p.offset)).toEqual([0, 4, 8]);
  });

  test("the server says where to continue (409) and the upload carries on from there", async () => {
    const { m, server } = setup({ chunkSize: 4 });
    // As if an earlier answer was lost: the server already has 8 bytes.
    server.failures.push((id) => {
      const u = server.uploads.get(id)!;
      u.offset = 8;
      u.bytes = [..."01234567"].map((c) => c.charCodeAt(0));
      return null;
    });
    const [t] = await m.add([file("0123456789")]).done;
    expect(t.state).toBe("done");
    expect(server.puts.map((p) => p.offset)).toEqual([8]);
    expect(String.fromCharCode(...server.uploads.get("up1")!.bytes)).toBe("0123456789");
  });

  test("a refusal (not a dropped connection) fails at once with the server's reason", async () => {
    const { m, server } = setup();
    server.failures.push(() => new ChunkError(413, "Send at most 32 MB at a time"));
    const [t] = await m.add([file("0123")]).done;
    expect(t).toMatchObject({ state: "failed", canRetry: false, error: "Send at most 32 MB at a time" });
  });

  test("a file the server won't take is refused before any bytes go", async () => {
    const { m, server } = setup();
    (server.t.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error("Only photos and videos can be added"), { status: 400 }));
    const [t] = await m.add([file("hello", "notes.txt")]).done;
    expect(t).toMatchObject({ state: "failed", canRetry: false, error: "Only photos and videos can be added" });
    expect(server.puts).toEqual([]);
  });

  test("Immich failing the hand-off shows its reason; Retry asks the server to try again", async () => {
    const { m, server } = setup();
    Object.assign(server.handoff, { result: "failed", error: "Couldn't reach Immich. Try again in a few minutes.", canRetry: true });
    const [t] = await m.add([file("0123")]).done;
    expect(t).toMatchObject({ state: "failed", canRetry: true, error: "Couldn't reach Immich. Try again in a few minutes." });
    await m.retry(t.key);
    await vi.waitFor(() => expect(m.snapshot()[0].state).toBe("done"));
    expect(server.t.retry).toHaveBeenCalledWith("up1");
    expect(server.puts).toHaveLength(1); // no bytes sent again
  });

  test("a duplicate is done, marked as already in the library", async () => {
    const { m, server } = setup();
    server.handoff.duplicate = true;
    const [t] = await m.add([file("0123")]).done;
    expect(t).toMatchObject({ state: "done", duplicate: true });
  });

  test("three files go at a time", async () => {
    const { m, server } = setup({ chunkSize: 100 });
    let inFlight = 0;
    let most = 0;
    const put = server.t.putChunk as ReturnType<typeof vi.fn>;
    const real = put.getMockImplementation()!;
    put.mockImplementation(async (...args: unknown[]) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return real(...args);
    });
    const tasks = await m.add(Array.from({ length: 7 }, (_, i) => file(`file ${i}`, `${i}.jpg`))).done;
    expect(tasks.every((t) => t.state === "done")).toBe(true);
    expect(most).toBe(3);
  });

  test("after a reload, an unfinished upload waits for its file and then continues from the server's offset", async () => {
    const server = fakeServer({ chunkSize: 4 });
    const resume = memoryResume();
    // Two pieces go up, then the page is closed (the third never comes back).
    let sentPieces = 0;
    const closing: Transport = { ...server.t, putChunk: (...args) => (++sentPieces > 2 ? new Promise(() => {}) : server.t.putChunk(...args)) };
    const first = new UploadManager({ transport: closing, resume, sleep: noSleep });
    const f = file("0123456789AB");
    first.add([f]);
    await vi.waitFor(() => expect(server.uploads.get("up1")?.offset).toBe(8));
    expect(resume.map.get(fingerprint(f))).toBe("up1");

    const second = new UploadManager({ transport: server.t, resume, sleep: noSleep });
    await second.restore();
    const [p] = second.snapshot();
    expect(p).toMatchObject({ state: "paused", name: "a.jpg", sent: 8, file: null });
    expect(second.resumeWith(p.key, file("other", "b.jpg"))).toMatch(/different file/);

    const before = server.puts.length;
    const [t] = await second.add([f]).done; // chosen again, from any picker
    expect(t.state).toBe("done");
    expect(server.puts.slice(before).map((x) => x.offset)).toEqual([8]);
    expect(String.fromCharCode(...server.uploads.get("up1")!.bytes)).toBe("0123456789AB");
    expect(resume.map.size).toBe(0);
  });

  test("cancelling stops the upload and tells the server", async () => {
    const { m, server } = setup({ chunkSize: 2 });
    const put = server.t.putChunk as ReturnType<typeof vi.fn>;
    const real = put.getMockImplementation()!;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    put.mockImplementation(async (...args: unknown[]) => {
      if (++calls === 2) await gate; // the second piece is still on its way
      return real(...args);
    });
    const { done } = m.add([file("0123456789")]);
    await vi.waitFor(() => expect(calls).toBe(2));
    await m.cancel(m.snapshot()[0].key);
    release();
    expect(await done).toEqual([]);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(2); // nothing more was sent
    expect(server.t.cancel).toHaveBeenCalledWith("up1");
    expect(m.snapshot()).toEqual([]);
  });
});
