import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { assertRefs, loadEditable, readableWhere, scopeOf } from "../lib/access.js";
import { recordActivity } from "../lib/activity.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import { uuid } from "../lib/validate.js";
import { ImmichError, immich } from "../lib/immich/client.js";
import { familyConnCached } from "../lib/immich/provision.js";
import { importToImmich, isMediaFile, NO_IMMICH, type ImportResult } from "../lib/media/import.js";
import { MEDIA_COLUMNS, mediaDto, type MediaDtoRow } from "../lib/media/dto.js";
import { filterSchema, filterSql, MONTH_OF, SORT_TS } from "../lib/media/filters.js";
import { mediaUrls } from "../lib/media/urls.js";

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

const listQuery = filterSchema.extend({
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z__[0-9a-f-]{36}$/i, "Bad cursor").optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
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
    const { where, params, add } = filterSql(q, req.user.familyId);
    if (q.before) {
      const sep = q.before.lastIndexOf("__");
      where.push(`(${SORT_TS}, m.id) < (${add(q.before.slice(0, sep))}::timestamptz, ${add(q.before.slice(sep + 2))}::uuid)`);
    }
    const limit = q.limit ?? 60;

    const { rows } = await query<MediaDtoRow & { sort_ts: string }>(
      `SELECT ${MEDIA_COLUMNS}, ${SORT_TS} AS sort_ts, f.name AS family_name
       FROM media m JOIN families f ON f.id = m.family_id
       WHERE ${where.join(" AND ")}
       ORDER BY ${SORT_TS} DESC, m.id DESC
       LIMIT ${limit}`,
      params,
    );
    const items = rows.map((r) => ({ ...mediaDto(r), cursor: `${new Date(r.sort_ts).toISOString()}__${r.id}` }));
    return { items, nextCursor: items.length === limit ? items[items.length - 1].cursor : null };
  });

  // How many photos each month has (newest first): the timeline is laid out
  // from this before any photos load.
  app.get("/api/media/timeline", async (req) => {
    const { where, params } = filterSql(filterSchema.parse(req.query), req.user.familyId);
    const { rows } = await query<{ month: string; count: number }>(
      `SELECT ${MONTH_OF} AS month, count(*)::int AS count FROM media m
        WHERE ${where.join(" AND ")} GROUP BY 1 ORDER BY 1 DESC`, params);
    return { months: rows, total: rows.reduce((n, r) => n + r.count, 0) };
  });

  // Every geotagged photo that matches, as compact points, for the map.
  app.get("/api/media/geo", async (req) => {
    const { where, params } = filterSql(filterSchema.parse(req.query), req.user.familyId);
    const { rows } = await query<{ id: string; lng: number; lat: number; kind: string }>(
      `SELECT m.id, ST_X(m.geom) AS lng, ST_Y(m.geom) AS lat, m.kind FROM media m
        WHERE ${where.join(" AND ")} AND m.geom IS NOT NULL
        ORDER BY ${SORT_TS} DESC LIMIT 200000`, params);
    return { points: rows.map((r) => [r.id, r.lng, r.lat, r.kind]) };
  });

  // Signed links for photos the map (or anything) is about to show.
  app.post("/api/media/links", async (req) => {
    const { ids } = z.object({ ids: z.array(uuid).max(200) }).parse(req.body);
    if (!ids.length) return {};
    const { rows } = await query<{ id: string; kind: string }>(
      `SELECT m.id, m.kind FROM media m WHERE m.id = ANY($1::uuid[]) AND ${readableWhere("media", "m", "$2")}`,
      [ids, req.user.familyId]);
    return Object.fromEntries(rows.map((r) => {
      const u = mediaUrls(r);
      return [r.id, { thumbUrl: u.thumbUrl, url: u.url }];
    }));
  });

  // Many photos at once: hide or show them, or put them in a trip (or none).
  app.post("/api/media/bulk", async (req) => {
    const b = z.object({
      mediaIds: z.array(uuid).min(1).max(1000),
      hidden: z.boolean().optional(),
      tripId: uuid.nullable().optional(),
    }).parse(req.body);
    const scope = scopeOf(req);
    const ids = [...new Set(b.mediaIds)];
    await assertRefs(scope, { media: ids }, { mode: "own" });
    await assertRefs(scope, { trip: b.tripId });
    if (b.hidden !== undefined) {
      await query(`UPDATE media SET hidden_at = ${b.hidden ? "COALESCE(hidden_at, now())" : "NULL"} WHERE id = ANY($1::uuid[]) AND family_id = $2`, [ids, scope.familyId]);
    }
    if (b.tripId !== undefined) {
      await query("UPDATE media SET trip_id = $1 WHERE id = ANY($2::uuid[]) AND family_id = $3", [b.tripId, ids, scope.familyId]);
      if (b.tripId) {
        await recordActivity({ tripId: b.tripId, familyId: scope.familyId, userId: scope.userId, kind: "photo.added",
          summary: `${ids.length} photo${ids.length === 1 ? "" : "s"}` });
      }
    }
    return { updated: ids.length };
  });

  app.get("/api/media/:id", async (req) => mediaDto(await loadMedia(req.user.familyId, (req.params as { id: string }).id)));

  const patchSchema = z.object({
    caption: z.string().max(500).optional(),
    tripId: z.string().uuid().nullable().optional(),
    /** Hidden from the library (Werejugo only; the photo stays in Immich). */
    hidden: z.boolean().optional(),
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
    if (b.hidden !== undefined) {
      await query(`UPDATE media SET hidden_at = ${b.hidden ? "COALESCE(hidden_at, now())" : "NULL"} WHERE id = $1 AND family_id = $2`, [id, scope.familyId]);
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
