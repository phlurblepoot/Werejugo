import { rm } from "node:fs/promises";
import type { Readable } from "node:stream";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { assertRefs, scopeOf } from "../lib/access.js";
import { requireAuth } from "../lib/auth.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { familyConnCached } from "../lib/immich/provision.js";
import { enqueueHandoff } from "../lib/jobs.js";
import { isAllowedPair } from "../lib/links.js";
import { MEDIA_COLUMNS, mediaDto, type MediaDtoRow } from "../lib/media/dto.js";
import { isMediaFile, NO_IMMICH } from "../lib/media/import.js";
import {
  CHUNK_SIZE, ChunkTooLarge, createPartFile, hasPartFile, MAX_CHUNK, partPath, withUploadLock, writeChunk, type UploadRow,
} from "../lib/media/uploads.js";
import { parseRef } from "../lib/refs.js";

/**
 * Uploading a photo or video in chunks (see lib/media/uploads.ts):
 * create → PUT the bytes in order (each request says where it starts) →
 * the file is handed to Immich in the background → poll until done.
 * An upload belongs to its family; anyone else gets 404.
 */

const createSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mime: z.string().max(200).default(""),
  lastModified: z.number().int().positive().optional(),
  caption: z.string().max(500).default(""),
  linkTo: z.string().max(100).optional(),
  linkRole: z.string().max(40).default(""),
});

const gb = (bytes: number) => `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`;

async function loadUpload(familyId: string, id: string): Promise<UploadRow> {
  const row = (await query<UploadRow>("SELECT * FROM media_uploads WHERE id = $1 AND family_id = $2", [id, familyId])).rows[0];
  if (!row) throw notFound("Upload not found");
  return row;
}

type Dto = ReturnType<typeof mediaDto>;

async function uploadDto(u: UploadRow, media?: Dto | null) {
  return {
    id: u.id, filename: u.filename, size: Number(u.size), mime: u.mime, offset: Number(u.received), state: u.state,
    duplicate: u.duplicate, error: u.error, linkTo: u.link_to, createdAt: u.created_at, updatedAt: u.updated_at,
    // A failed hand-off can be tried again while the bytes are still here.
    canRetry: u.state === "failed" && (await hasPartFile(u.id)),
    media: media ?? null,
  };
}

async function mediaFor(familyId: string, ids: string[]): Promise<Map<string, Dto>> {
  if (!ids.length) return new Map();
  const { rows } = await query<MediaDtoRow>(
    `SELECT ${MEDIA_COLUMNS}, f.name AS family_name FROM media m JOIN families f ON f.id = m.family_id
      WHERE m.id = ANY($1::uuid[]) AND m.family_id = $2`, [ids, familyId]);
  return new Map(rows.map((r) => [r.id, mediaDto(r)]));
}

export async function mediaUploadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  // Chunks arrive as raw bytes; the route streams them to disk (only in this plugin).
  app.addContentTypeParser("application/octet-stream", (_req, payload, done) => done(null, payload));

  app.post("/api/media/uploads", async (req, reply) => {
    const b = createSchema.parse(req.body);
    const scope = scopeOf(req);
    if (!isMediaFile(b.filename, b.mime)) throw badRequest("Only photos and videos can be added");
    if (b.size > config.maxUploadBytes) throw badRequest(`That file is ${gb(b.size)}; the most one upload can be is ${gb(config.maxUploadBytes)}`);
    if (b.linkTo) {
      const ref = parseRef(b.linkTo);
      // A place or person is linked; a trip becomes the photo's trip.
      if (!ref || !(ref.type === "trip" || isAllowedPair("media", ref.type))) throw badRequest("Photos can't be linked to that");
      await assertRefs(scope, { [ref.type]: ref.id });
    }
    if (!(await familyConnCached(scope.familyId).catch(() => null))) throw new HttpError(409, NO_IMMICH);

    const row = (await query<UploadRow>(
      `INSERT INTO media_uploads (family_id, user_id, filename, mime, size, file_modified_at, caption, link_to, link_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [scope.familyId, scope.userId, b.filename, b.mime, b.size, b.lastModified ? new Date(b.lastModified).toISOString() : null,
        b.caption, b.linkTo ?? null, b.linkRole])).rows[0];
    await createPartFile(row.id);
    return reply.code(201).send({ ...(await uploadDto(row)), chunkSize: CHUNK_SIZE });
  });

  // My uploads that aren't finished (and those that just finished): the upload tray after a reload.
  app.get("/api/media/uploads", async (req) => {
    const rows = (await query<UploadRow>(
      `SELECT * FROM media_uploads
        WHERE family_id = $1 AND user_id = $2
          AND ((state <> 'done' AND updated_at > now() - interval '48 hours') OR (state = 'done' AND updated_at > now() - interval '10 minutes'))
        ORDER BY created_at`, [req.user.familyId, req.user.id])).rows;
    const media = await mediaFor(req.user.familyId, rows.flatMap((r) => (r.media_id ? [r.media_id] : [])));
    return { items: await Promise.all(rows.map((r) => uploadDto(r, r.media_id ? media.get(r.media_id) : null))) };
  });

  app.get("/api/media/uploads/:id", async (req) => {
    const u = await loadUpload(req.user.familyId, (req.params as { id: string }).id);
    const media = u.media_id ? (await mediaFor(u.family_id, [u.media_id])).get(u.media_id) : null;
    return uploadDto(u, media);
  });

  // The next piece of the file. `offset` is where it starts; it must be exactly
  // what's been received so far (409 says where to continue from otherwise).
  app.put("/api/media/uploads/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const { offset } = z.object({ offset: z.coerce.number().int().min(0) }).parse(req.query);
    const body = req.body as Readable | undefined;

    return withUploadLock(id, async () => {
      const u = await loadUpload(req.user.familyId, id);
      if (!body || typeof body.pipe !== "function") throw badRequest("Send the bytes as application/octet-stream");
      const received = Number(u.received);
      if (u.state !== "receiving") return reply.code(409).send({ error: "This upload already has all its bytes", offset: received, state: u.state });
      if (offset !== received) return reply.code(409).send({ error: `The server has ${received} bytes of this file; continue from there`, offset: received, state: u.state });

      const room = Number(u.size) - received;
      const declared = Number(req.headers["content-length"] ?? NaN);
      if (declared > MAX_CHUNK) throw new HttpError(413, `Send at most ${MAX_CHUNK / 1024 / 1024} MB at a time`);
      if (declared > room) throw badRequest("That's more bytes than the file has");

      let n: number;
      try {
        n = await writeChunk(id, offset, body, Math.min(room, MAX_CHUNK));
      } catch (e) {
        if (e instanceof ChunkTooLarge) throw room < MAX_CHUNK ? badRequest("That's more bytes than the file has") : new HttpError(413, `Send at most ${MAX_CHUNK / 1024 / 1024} MB at a time`);
        // A dropped connection: nothing is recorded, and the piece is simply sent again.
        const code = (e as { code?: string }).code;
        if (req.raw.destroyed || code === "ERR_STREAM_PREMATURE_CLOSE" || code === "ECONNRESET") throw badRequest("The connection dropped; send this piece again");
        throw e;
      }

      const r = (await query<{ received: string; state: UploadRow["state"] }>(
        `UPDATE media_uploads
            SET received = received + $3, updated_at = now(),
                state = CASE WHEN received + $3 = size THEN 'processing' ELSE state END
          WHERE id = $1 AND family_id = $2 AND received = $4 AND state = 'receiving'
        RETURNING received, state`, [id, req.user.familyId, n, offset])).rows[0];
      if (!r) return reply.code(409).send({ error: "This upload changed while the bytes arrived; ask where to continue", offset: received });
      if (r.state === "processing") await enqueueHandoff(id);
      return { offset: Number(r.received), state: r.state };
    });
  });

  // Try the hand-off to Immich again (after "Couldn't reach Immich").
  app.post("/api/media/uploads/:id/retry", async (req) => {
    const u = await loadUpload(req.user.familyId, (req.params as { id: string }).id);
    if (u.state !== "failed") throw new HttpError(409, "Only a failed upload can be tried again");
    if (!(await hasPartFile(u.id)) || Number(u.received) !== Number(u.size)) throw new HttpError(409, "Choose the file again to upload it");
    await query("UPDATE media_uploads SET state = 'processing', error = NULL, updated_at = now() WHERE id = $1 AND family_id = $2", [u.id, u.family_id]);
    await enqueueHandoff(u.id);
    return uploadDto({ ...u, state: "processing", error: null });
  });

  // Cancel: the bytes and the upload go (not while Immich is being handed the file).
  app.delete("/api/media/uploads/:id", async (req, reply) => {
    const u = await loadUpload(req.user.familyId, (req.params as { id: string }).id);
    if (u.state === "processing") throw new HttpError(409, "It's being added to Immich; it can't be cancelled now");
    await withUploadLock(u.id, async () => {
      await query("DELETE FROM media_uploads WHERE id = $1 AND family_id = $2", [u.id, u.family_id]);
      await rm(partPath(u.id), { force: true });
    });
    return reply.code(204).send();
  });
}
