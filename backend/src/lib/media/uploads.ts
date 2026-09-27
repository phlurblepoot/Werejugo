import { createWriteStream, openAsBlob } from "node:fs";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../../config.js";
import { query } from "../../db/pool.js";
import { HttpError } from "../errors.js";
import { ImmichError } from "../immich/client.js";
import { familyConnCached } from "../immich/provision.js";
import { assertRefs } from "../access.js";
import { createLink } from "../links.js";
import { importToImmich, NO_IMMICH } from "./import.js";

/**
 * Uploads in chunks (routes/media-uploads.ts). The browser sends a file in
 * small pieces (each well under Cloudflare's 100 MB limit), which are written
 * straight to UPLOADS_DIR/incoming/<id>.part. When the last byte arrives the
 * file is handed to the family's Immich account in the background.
 */

/** What the browser is asked to send per request. */
export const CHUNK_SIZE = 8 * 1024 * 1024;
/** The most one request may carry. */
export const MAX_CHUNK = 32 * 1024 * 1024;

const incomingDir = () => join(config.uploadsDir, "incoming");
export const partPath = (id: string) => join(incomingDir(), `${id}.part`);

export interface UploadRow {
  id: string; family_id: string; user_id: string | null; filename: string; mime: string;
  size: string; file_modified_at: Date | string | null; caption: string; link_to: string | null; link_role: string;
  received: string; state: "receiving" | "processing" | "done" | "failed";
  media_id: string | null; duplicate: boolean; error: string | null; created_at: string; updated_at: string;
}

export async function createPartFile(id: string): Promise<void> {
  await mkdir(incomingDir(), { recursive: true });
  await (await open(partPath(id), "w")).close();
}

export const hasPartFile = (id: string) => stat(partPath(id)).then((s) => s.isFile(), () => false);

export class ChunkTooLarge extends Error {}

/**
 * Write a request body into the file at `offset`, taking at most `limit` bytes
 * (more is refused with ChunkTooLarge). Returns how many bytes were written.
 */
export async function writeChunk(id: string, offset: number, body: Readable, limit: number): Promise<number> {
  let n = 0;
  const count = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length;
      if (n > limit) cb(new ChunkTooLarge());
      else cb(null, chunk);
    },
  });
  await pipeline(body, count, createWriteStream(partPath(id), { flags: "r+", start: offset }));
  return n;
}

// One chunk at a time per upload (a retried request waits for the first to finish).
const locks = new Map<string, Promise<unknown>>();
export async function withUploadLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(id, tail);
  try {
    return await run;
  } finally {
    if (locks.get(id) === tail) locks.delete(id);
  }
}

async function finish(id: string, fields: { state: "done" | "failed"; mediaId?: string; duplicate?: boolean; error?: string | null }) {
  await query(
    `UPDATE media_uploads SET state = $2, media_id = COALESCE($3, media_id), duplicate = $4, error = $5, updated_at = now()
      WHERE id = $1`,
    [id, fields.state, fields.mediaId ?? null, fields.duplicate ?? false, fields.error ?? null]);
}

const UNREACHABLE = "Couldn't reach Immich. Try again in a few minutes.";

/**
 * Hand a fully received upload to Immich. `finalAttempt` false: a passing
 * problem (Immich down, a timeout) is thrown so the job queue tries again
 * later; true: the upload is marked failed, and its bytes kept for a retry.
 */
export async function handOff(id: string, opts: { finalAttempt: boolean }): Promise<void> {
  const u = (await query<UploadRow>("SELECT * FROM media_uploads WHERE id = $1 AND state = 'processing'", [id])).rows[0];
  if (!u) return;
  const conn = await familyConnCached(u.family_id).catch(() => null);
  if (!conn) return finish(id, { state: "failed", error: NO_IMMICH });

  let file: Blob;
  try {
    file = await openAsBlob(partPath(id), { type: u.mime });
  } catch {
    return finish(id, { state: "failed", error: "The file's bytes are gone. Choose the file again." });
  }

  try {
    const r = await importToImmich(conn, {
      familyId: u.family_id, userId: u.user_id, file, filename: u.filename, exifSource: partPath(id),
      fileModifiedAt: u.file_modified_at ? new Date(u.file_modified_at).toISOString() : null, caption: u.caption || undefined,
    });
    let note: string | null = null;
    // What it was added for (a place, a person, a trip), as the person who added it.
    if (u.link_to && u.user_id) {
      const scope = { userId: u.user_id, familyId: u.family_id, role: "member" as const, isAdmin: false };
      try {
        if (u.link_to.startsWith("trip:")) {
          const tripId = u.link_to.slice(5);
          await assertRefs(scope, { trip: tripId });
          await query("UPDATE media SET trip_id = $1 WHERE id = $2 AND family_id = $3", [tripId, r.mediaId, u.family_id]);
        } else {
          await createLink(scope, `media:${r.mediaId}`, u.link_to, u.link_role);
        }
      } catch (e) {
        note = `Added, but not linked: ${e instanceof Error ? e.message : "the link failed"}`;
      }
    }
    await finish(id, { state: "done", mediaId: r.mediaId, duplicate: r.duplicate, error: note });
    await rm(partPath(id), { force: true });
  } catch (e) {
    // Immich refused the file (or it belongs elsewhere): trying again won't help.
    if ((e instanceof ImmichError && e.kind === "rejected") || e instanceof HttpError) {
      await finish(id, { state: "failed", error: e.message });
      await rm(partPath(id), { force: true });
      return;
    }
    if (!opts.finalAttempt) throw e;
    await finish(id, { state: "failed", error: e instanceof ImmichError && e.kind === "unreachable" ? UNREACHABLE : `Couldn't add it to Immich: ${e instanceof Error ? e.message : "unknown error"}` });
  }
}

/**
 * Daily housekeeping: uploads abandoned half-way (2 days), failures (7 days),
 * finished rows (1 day), hand-offs that never finished (6 hours), and part
 * files nothing refers to.
 */
export async function cleanupUploads(): Promise<{ removed: number; orphans: number }> {
  await query(
    `UPDATE media_uploads SET state = 'failed', error = 'Adding it to Immich didn''t finish. Try again.', updated_at = now()
      WHERE state = 'processing' AND updated_at < now() - interval '6 hours'`);
  const gone = (await query<{ id: string }>(
    `DELETE FROM media_uploads
      WHERE (state = 'receiving' AND updated_at < now() - interval '48 hours')
         OR (state = 'failed' AND updated_at < now() - interval '7 days')
         OR (state = 'done' AND updated_at < now() - interval '1 day')
      RETURNING id`)).rows;
  for (const g of gone) await rm(partPath(g.id), { force: true });

  let orphans = 0;
  const names = await readdir(incomingDir()).catch(() => [] as string[]);
  const ids = names.filter((n) => /^[0-9a-f-]{36}\.part$/.test(n)).map((n) => n.slice(0, 36));
  if (ids.length) {
    const known = new Set((await query<{ id: string }>("SELECT id FROM media_uploads WHERE id = ANY($1::uuid[])", [ids])).rows.map((r) => r.id));
    for (const id of ids) {
      if (known.has(id)) continue;
      const s = await stat(partPath(id)).catch(() => null);
      if (s && Date.now() - s.mtimeMs > 60 * 60_000) {
        await rm(partPath(id), { force: true });
        orphans++;
      }
    }
  }
  return { removed: gone.length, orphans };
}
