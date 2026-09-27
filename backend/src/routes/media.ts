import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { assertRefs, loadEditable, readableWhere, scopeOf } from "../lib/access.js";
import { recordActivity } from "../lib/activity.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { uuid, ymd } from "../lib/validate.js";
import { ImmichError, immich } from "../lib/immich/client.js";
import { familyConnCached } from "../lib/immich/provision.js";
import { importToImmich, isMediaFile, NO_IMMICH, type ImportResult } from "../lib/media/import.js";
import { MEDIA_COLUMNS, mediaDto, type MediaDtoRow } from "../lib/media/dto.js";

/**
 * Photos and videos. They live in the family's Immich account; Werejugo keeps
 * a reference (with date, place, size and caption) and serves them at its own
 * signed URLs (routes/media-files.ts).
 */

async function connFor(familyId: string) {
  const conn = await familyConnCached(familyId);
  if (!conn) throw new HttpError(409, NO_IMMICH);
  return conn;
}

/** Immich trouble becomes a 502 with its message (a 4xx from Immich is ours to explain). */
function fromImmich(e: unknown): never {
  if (e instanceof ImmichError) throw new HttpError(e.kind === "rejected" ? 400 : 502, e.message);
  throw e;
}

async function loadMedia(familyId: string, id: string): Promise<MediaDtoRow> {
  const { rows } = await query<MediaDtoRow>(
    `SELECT ${MEDIA_COLUMNS}, f.name AS family_name FROM media m JOIN families f ON f.id = m.family_id
      WHERE m.id = $1 AND ${readableWhere("media", "m", "$2")}`, [id, familyId],
  );
  if (!rows[0]) throw notFound("Photo or video not found");
  return rows[0];
}

const listQuery = z.object({
  trip: uuid.optional(),
  person: uuid.optional(),
  visit: uuid.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  bbox: z.string().max(200).optional(),
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z__[0-9a-f-]{36}$/i, "Bad cursor").optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Upload a photo or video (multipart: `file`, optional `caption`). The file
  // goes to the family's Immich account; a file already there comes back as
  // `duplicate: true`.
  app.post("/api/media", async (req, reply) => {
    const conn = await connFor(req.user.familyId);
    let caption = "";
    let file: { buf: Buffer; name: string; mime: string } | null = null;
    for await (const part of req.parts()) {
      if (part.type === "file") file = { buf: await part.toBuffer(), name: part.filename || "upload", mime: part.mimetype };
      else if (part.fieldname === "caption" && typeof part.value === "string") caption = part.value.slice(0, 500);
    }
    if (!file || file.buf.length === 0) throw badRequest("No file provided");
    if (!isMediaFile(file.name, file.mime)) throw badRequest("Only photos and videos can be added");

    let result: ImportResult;
    try {
      result = await importToImmich(conn, {
        familyId: req.user.familyId, userId: req.user.id, file: new Blob([file.buf], { type: file.mime }),
        filename: file.name, exifSource: file.buf, caption,
      });
    } catch (e) {
      return fromImmich(e);
    }
    const { mediaId, duplicate } = result;
    const dto = mediaDto(await loadMedia(req.user.familyId, mediaId));
    return reply.code(duplicate ? 200 : 201).send({ ...dto, duplicate });
  });

  app.get("/api/media", async (req) => {
    const q = listQuery.parse(req.query);
    const params: unknown[] = [req.user.familyId];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    // The library is my family's photos. A trip's album is everyone's photos on
    // that trip that I may see (other families' only when it's shared with us).
    const where: string[] = q.trip
      ? [`m.trip_id = ${add(q.trip)}`, readableWhere("media", "m", "$1")]
      : ["m.family_id = $1"];
    if (q.person) {
      const ph = add(q.person); // capture the "$N" placeholder once; use it in both directions
      where.push(`EXISTS (SELECT 1 FROM links l WHERE l.family_id = m.family_id
        AND ((l.from_type='media' AND l.from_id=m.id AND l.to_type='person' AND l.to_id=${ph})
          OR (l.to_type='media' AND l.to_id=m.id AND l.from_type='person' AND l.from_id=${ph})))`);
    }
    if (q.visit) {
      const ph = add(q.visit);
      where.push(`EXISTS (SELECT 1 FROM links l WHERE l.family_id = m.family_id
        AND ((l.from_type='media' AND l.from_id=m.id AND l.to_type='visit' AND l.to_id=${ph})
          OR (l.to_type='media' AND l.to_id=m.id AND l.from_type='visit' AND l.from_id=${ph})))`);
    }
    if (q.from) where.push(`COALESCE(m.taken_at, m.created_at)::date >= ${add(q.from)}::date`);
    if (q.to) where.push(`COALESCE(m.taken_at, m.created_at)::date <= ${add(q.to)}::date`);
    if (q.bbox) {
      const b = q.bbox.split(",").map(Number);
      if (b.length === 4 && b.every(Number.isFinite)) {
        where.push(`m.geom && ST_MakeEnvelope(${add(b[0])},${add(b[1])},${add(b[2])},${add(b[3])},4326)`);
      }
    }
    if (q.before) {
      const sep = q.before.lastIndexOf("__");
      where.push(`(COALESCE(m.taken_at, m.created_at), m.id) < (${add(q.before.slice(0, sep))}::timestamptz, ${add(q.before.slice(sep + 2))}::uuid)`);
    }
    const limit = q.limit ?? 60;

    const { rows } = await query<MediaDtoRow & { sort_ts: string }>(
      `SELECT ${MEDIA_COLUMNS}, COALESCE(m.taken_at, m.created_at) AS sort_ts, f.name AS family_name
       FROM media m JOIN families f ON f.id = m.family_id
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(m.taken_at, m.created_at) DESC, m.id DESC
       LIMIT ${limit}`,
      params,
    );
    const items = rows.map((r) => ({ ...mediaDto(r), cursor: `${new Date(r.sort_ts).toISOString()}__${r.id}` }));
    return { items, nextCursor: items.length === limit ? items[items.length - 1].cursor : null };
  });

  app.get("/api/media/:id", async (req) => mediaDto(await loadMedia(req.user.familyId, (req.params as { id: string }).id)));

  const patchSchema = z.object({
    caption: z.string().max(500).optional(),
    tripId: z.string().uuid().nullable().optional(),
  });

  app.patch("/api/media/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    const row = await loadEditable<{ immich_asset_id: string }>("media", id, scope, { columns: "t.immich_asset_id" });
    const b = patchSchema.parse(req.body);
    await assertRefs(scope, { trip: b.tripId });

    if (b.caption !== undefined) {
      // The caption is the photo's description in Immich too.
      const conn = await connFor(scope.familyId);
      await immich.setDescription(conn, row.immich_asset_id, b.caption).catch(fromImmich);
      await query("UPDATE media SET caption = $2 WHERE id = $1 AND family_id = $3", [id, b.caption, scope.familyId]);
    }
    if (Object.prototype.hasOwnProperty.call(b, "tripId")) {
      await query("UPDATE media SET trip_id = $1 WHERE id = $2 AND family_id = $3", [b.tripId ?? null, id, scope.familyId]);
      await recordActivity({ tripId: b.tripId, familyId: scope.familyId, userId: scope.userId, kind: "photo.added", targetType: "media", targetId: id });
    }
    return mediaDto(await loadMedia(scope.familyId, id));
  });

  // Delete: the photo goes to Immich's trash (restorable there) and leaves Werejugo.
  app.delete("/api/media/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    const row = await loadEditable<{ immich_asset_id: string }>("media", id, scope, { columns: "t.immich_asset_id" });
    const conn = await connFor(scope.familyId);
    try {
      await immich.trashAssets(conn, [row.immich_asset_id]);
    } catch (e) {
      // Already gone from Immich is fine; anything else keeps the reference.
      if (!(e instanceof ImmichError && e.kind === "rejected")) return fromImmich(e);
    }
    await query("DELETE FROM media WHERE id = $1 AND family_id = $2", [id, scope.familyId]);
    return reply.code(204).send();
  });
}
