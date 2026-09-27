import type { MediaDto, MediaUpload } from "../../api/client";

/**
 * Uploads photos and videos in pieces, so a big video survives a flaky
 * connection and Cloudflare's per-request limit. Each file:
 *   create on the server → send pieces in order (retrying, and continuing
 *   from wherever the server says it got to) → wait while the server hands it
 *   to Immich → done (or failed, with a reason and usually a Retry).
 * Three files go at a time. An upload interrupted by a reload continues once
 * the same file is chosen again (recognised by name, size and date).
 * Plain TypeScript with a subscribe/snapshot store, so React can watch it and
 * tests can drive it with a fake server.
 */

export type TaskState = "queued" | "uploading" | "processing" | "done" | "failed" | "paused";

export interface UploadTask {
  key: string;
  uploadId: string | null;
  name: string;
  size: number;
  /** The file itself; null for an upload found after a reload until it's chosen again. */
  file: File | null;
  /** Bytes the server has confirmed. */
  sent: number;
  /** Bytes of the piece on its way. */
  inflight: number;
  state: TaskState;
  error: string | null;
  /** Failed, but Retry can pick it up (resend, or ask the server to try Immich again). */
  canRetry: boolean;
  duplicate: boolean;
  media: MediaDto | null;
  batch: string;
  caption: string;
  linkTo?: string;
  linkRole?: string;
}

export type ServerUpload = MediaUpload;

/** A piece the server didn't take: `status` 0 means the connection failed. */
export class ChunkError extends Error {
  constructor(public status: number, message: string, public offset?: number) {
    super(message);
  }
}

export interface Transport {
  create(body: { filename: string; size: number; mime: string; lastModified?: number; caption?: string; linkTo?: string; linkRole?: string }): Promise<ServerUpload & { chunkSize: number }>;
  get(id: string): Promise<ServerUpload>;
  list(): Promise<{ items: ServerUpload[] }>;
  putChunk(id: string, offset: number, piece: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<{ offset: number; state: ServerUpload["state"] }>;
  retry(id: string): Promise<ServerUpload>;
  cancel(id: string): Promise<void>;
}

/** Remembers which server upload a file belongs to, across reloads. */
export interface ResumeStore {
  get(fingerprint: string): string | null;
  set(fingerprint: string, uploadId: string): void;
  remove(fingerprint: string): void;
}

export interface AddOptions {
  linkTo?: string;
  linkRole?: string;
  /** Called as each file finishes (done, with its photo). */
  onEach?: (task: UploadTask) => void;
}

export interface ManagerOptions {
  transport: Transport;
  resume: ResumeStore;
  /** Called whenever a file is added to the library (to refresh what shows photos). */
  onFinished?: (task: UploadTask) => void;
  /** Waits between attempts at a piece; the last failure marks the file failed. */
  retryDelaysMs?: number[];
  pollDelaysMs?: number[];
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const fingerprint = (f: { name: string; size: number; lastModified?: number }) => `${f.name}|${f.size}|${f.lastModified ?? 0}`;

const TERMINAL: TaskState[] = ["done", "failed"];
const DEFAULT_CHUNK = 8 * 1024 * 1024;

let seq = 0;

export class UploadManager {
  private tasks: UploadTask[] = [];
  private listeners = new Set<() => void>();
  private aborts = new Map<string, AbortController>();
  private chunkSizes = new Map<string, number>();
  private batches = new Map<string, { resolve: (t: UploadTask[]) => void; onEach?: (t: UploadTask) => void }>();
  private active = 0;
  private readonly o: Required<Omit<ManagerOptions, "onFinished">> & Pick<ManagerOptions, "onFinished">;

  constructor(opts: ManagerOptions) {
    this.o = {
      transport: opts.transport,
      resume: opts.resume,
      onFinished: opts.onFinished,
      retryDelaysMs: opts.retryDelaysMs ?? [1000, 2000, 4000, 8000, 15000, 30000],
      pollDelaysMs: opts.pollDelaysMs ?? [1500, 1500, 2000, 3000, 5000],
      concurrency: opts.concurrency ?? 3,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  // ---- store ----
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  snapshot = () => this.tasks;
  private emit() {
    this.tasks = [...this.tasks];
    for (const l of this.listeners) l();
  }
  private update(key: string, patch: Partial<UploadTask>) {
    this.tasks = this.tasks.map((t) => (t.key === key ? { ...t, ...patch } : t));
    for (const l of this.listeners) l();
  }
  private find(key: string) { return this.tasks.find((t) => t.key === key); }

  /** Anything still sending bytes (worth a "leave this page?" warning). */
  get sending(): boolean { return this.tasks.some((t) => t.state === "queued" || t.state === "uploading"); }

  // ---- adding ----

  /**
   * Queue files. Resolves `done` when every one of them has finished or
   * failed. A file that matches an interrupted upload continues it.
   */
  add(items: Array<File | { file: File; caption?: string }>, opts: AddOptions = {}): { batch: string; done: Promise<UploadTask[]> } {
    const batch = `b${++seq}`;
    const fresh: UploadTask[] = [];
    for (const it of items) {
      const file = it instanceof File ? it : it.file;
      const caption = it instanceof File ? "" : it.caption ?? "";
      // The same file as an interrupted upload in the tray: continue that one.
      const paused = this.tasks.find((t) => t.state === "paused" && !t.file && t.name === file.name && t.size === file.size);
      if (paused) {
        this.update(paused.key, { file, state: "queued", batch, error: null, linkTo: opts.linkTo ?? paused.linkTo, linkRole: opts.linkRole ?? paused.linkRole });
        fresh.push(this.find(paused.key)!);
        continue;
      }
      fresh.push({
        key: `u${++seq}`, uploadId: null, name: file.name, size: file.size, file, sent: 0, inflight: 0,
        state: "queued", error: null, canRetry: false, duplicate: false, media: null, batch, caption,
        linkTo: opts.linkTo, linkRole: opts.linkRole,
      });
    }
    this.tasks = [...this.tasks.filter((t) => !fresh.some((f) => f.key === t.key)), ...fresh];
    this.emit();
    const done = new Promise<UploadTask[]>((resolve) => { this.batches.set(batch, { resolve, onEach: opts.onEach }); });
    if (!fresh.length) this.settleBatch(batch);
    this.pump();
    return { batch, done };
  }

  /** After a reload: show my unfinished uploads (a paused one continues when its file is chosen again). */
  async restore(): Promise<void> {
    let items: ServerUpload[];
    try {
      items = (await this.o.transport.list()).items;
    } catch {
      return;
    }
    for (const s of items) {
      if (this.tasks.some((t) => t.uploadId === s.id) || s.state === "done") continue;
      const task: UploadTask = {
        key: `u${++seq}`, uploadId: s.id, name: s.filename, size: s.size, file: null, sent: s.offset, inflight: 0,
        state: s.state === "receiving" ? "paused" : s.state === "processing" ? "processing" : "failed",
        error: s.state === "failed" ? s.error : null, canRetry: s.canRetry, duplicate: false, media: null, batch: "restored", caption: "",
      };
      this.tasks = [...this.tasks, task];
      if (task.state === "processing") void this.poll(task.key);
    }
    this.emit();
  }

  // ---- actions ----

  /** Choose the file again for a paused upload. */
  resumeWith(key: string, file: File): string | null {
    const t = this.find(key);
    if (!t) return null;
    if (file.name !== t.name || file.size !== t.size) return `That's a different file. Choose "${t.name}".`;
    this.update(key, { file, state: "queued", error: null });
    this.pump();
    return null;
  }

  async retry(key: string): Promise<void> {
    const t = this.find(key);
    if (!t || t.state !== "failed") return;
    // All the bytes are there: ask the server to hand it to Immich again.
    if (t.uploadId && t.sent >= t.size && t.canRetry) {
      this.update(key, { state: "processing", error: null });
      try {
        await this.o.transport.retry(t.uploadId);
      } catch (e) {
        this.fail(key, e instanceof Error ? e.message : "Couldn't try again", false);
        return;
      }
      void this.poll(key);
      return;
    }
    if (!t.file) {
      this.update(key, { state: "paused", error: null });
      return;
    }
    this.update(key, { state: "queued", error: null });
    this.pump();
  }

  async cancel(key: string): Promise<void> {
    const t = this.find(key);
    if (!t || t.state === "processing") return;
    this.aborts.get(key)?.abort();
    if (t.uploadId && t.state !== "done") await this.o.transport.cancel(t.uploadId).catch(() => {});
    if (t.file) this.o.resume.remove(fingerprint(t.file));
    this.tasks = this.tasks.filter((x) => x.key !== key);
    this.emit();
    this.settleBatch(t.batch);
    this.pump();
  }

  /** Hide one finished upload. */
  dismiss(key: string): void {
    this.tasks = this.tasks.filter((t) => !(t.key === key && t.state === "done"));
    this.emit();
  }

  clearFinished(): void {
    this.tasks = this.tasks.filter((t) => t.state !== "done");
    this.emit();
  }

  // ---- the work ----

  private pump() {
    while (this.active < this.o.concurrency) {
      const next = this.tasks.find((t) => t.state === "queued");
      if (!next) return;
      this.active++;
      this.update(next.key, { state: "uploading" });
      void this.send(next.key).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async send(key: string): Promise<void> {
    const t = this.find(key)!;
    const file = t.file!;
    const fp = fingerprint(file);
    const tr = this.o.transport;
    try {
      // Continue an upload the server already has part of.
      let id = t.uploadId ?? this.o.resume.get(fp);
      let sent = 0;
      if (id) {
        try {
          const s = await tr.get(id);
          if (s.size !== file.size || s.state === "failed") id = null;
          else if (s.state === "done") return this.complete(key, s);
          else if (s.state === "processing") {
            this.update(key, { uploadId: id, sent: s.size, state: "processing" });
            return void (await this.poll(key));
          } else sent = s.offset;
        } catch {
          id = null;
        }
      }
      if (!id) {
        const c = await tr.create({
          filename: file.name, size: file.size, mime: file.type, lastModified: file.lastModified || undefined,
          caption: t.caption || undefined, linkTo: t.linkTo, linkRole: t.linkRole,
        });
        id = c.id;
        this.chunkSizes.set(id, c.chunkSize);
        this.o.resume.set(fp, id);
      }
      this.update(key, { uploadId: id, sent });

      const chunk = this.chunkSizes.get(id) ?? DEFAULT_CHUNK;
      let attempt = 0;
      while (sent < file.size) {
        const cur = this.find(key);
        if (!cur || cur.state !== "uploading") return; // cancelled
        const ctrl = new AbortController();
        this.aborts.set(key, ctrl);
        try {
          const r = await tr.putChunk(id, sent, file.slice(sent, sent + chunk), (loaded) => this.update(key, { inflight: loaded }), ctrl.signal);
          sent = r.offset;
          attempt = 0;
          this.update(key, { sent, inflight: 0 });
          if (r.state === "processing") break;
        } catch (e) {
          this.update(key, { inflight: 0 });
          if (ctrl.signal.aborted) return;
          const err = e instanceof ChunkError ? e : new ChunkError(0, e instanceof Error ? e.message : "Upload failed");
          if (err.status === 409 && typeof err.offset === "number") {
            sent = err.offset; // the server says where to continue
            this.update(key, { sent });
            continue;
          }
          if (err.status === 404) {
            this.o.resume.remove(fp);
            this.update(key, { uploadId: null, sent: 0 });
            return this.fail(key, "The server lost this upload. Retry to start it again.", true);
          }
          const passing = err.status === 0 || err.status >= 500 || err.status === 408 || err.status === 429;
          if (!passing) return this.fail(key, err.message, false);
          if (attempt >= this.o.retryDelaysMs.length) return this.fail(key, "The connection keeps dropping. Retry to continue where it stopped.", true);
          await this.o.sleep(this.o.retryDelaysMs[attempt++]);
        } finally {
          this.aborts.delete(key);
        }
      }
      if (sent >= file.size) {
        this.update(key, { state: "processing", sent: file.size });
        await this.poll(key);
      }
    } catch (e) {
      // Creating (or asking about) the upload failed.
      const status = (e as { status?: number }).status ?? 0;
      this.fail(key, e instanceof Error ? e.message : "Upload failed", status === 0 || status >= 500);
    }
  }

  /** Wait while the server hands the file to Immich. */
  private async poll(key: string): Promise<void> {
    let i = 0;
    for (;;) {
      const t = this.find(key);
      if (!t || t.state !== "processing" || !t.uploadId) return;
      await this.o.sleep(this.o.pollDelaysMs[Math.min(i++, this.o.pollDelaysMs.length - 1)]);
      let s: ServerUpload;
      try {
        s = await this.o.transport.get(t.uploadId);
      } catch (e) {
        if ((e as { status?: number }).status === 404) return this.fail(key, "The server lost this upload.", false);
        continue; // try again at the next poll
      }
      if (s.state === "done") return this.complete(key, s);
      if (s.state === "failed") return this.fail(key, s.error ?? "Couldn't add it to Immich", s.canRetry);
    }
  }

  private complete(key: string, s: ServerUpload) {
    const t = this.find(key);
    if (!t) return;
    if (t.file) this.o.resume.remove(fingerprint(t.file));
    this.update(key, { state: "done", sent: t.size, inflight: 0, media: s.media, duplicate: s.duplicate, error: s.error, canRetry: false });
    const done = this.find(key)!;
    this.o.onFinished?.(done);
    this.batches.get(t.batch)?.onEach?.(done);
    this.settleBatch(t.batch);
  }

  private fail(key: string, error: string, canRetry: boolean) {
    const t = this.find(key);
    if (!t) return;
    this.update(key, { state: "failed", error, canRetry, inflight: 0 });
    this.settleBatch(t.batch);
  }

  private settleBatch(batch: string) {
    const b = this.batches.get(batch);
    if (!b) return;
    const mine = this.tasks.filter((t) => t.batch === batch);
    if (mine.every((t) => TERMINAL.includes(t.state))) {
      this.batches.delete(batch);
      b.resolve(mine);
    }
  }
}
