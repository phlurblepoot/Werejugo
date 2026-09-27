import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { fetchMedia, ImmichError, type MediaSize } from "../lib/immich/client.js";
import { familyConnCached } from "../lib/immich/provision.js";
import { MEDIA_SIZES, verifyMediaSig } from "../lib/media/urls.js";

const PASS_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

/**
 * Photos and videos, served at Werejugo's own URLs from the owning family's
 * Immich account. No login: the signed link is the permission (links are only
 * made for media the viewer may see — in the app or on a public share page).
 * Range requests (video seeking) and ETags (browser caching) pass straight
 * through to Immich.
 */
export async function mediaFileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/m/:id/:size", async (req, reply) => {
    const { id, size } = req.params as { id: string; size: string };
    const { e, s } = req.query as { e?: string; s?: string };
    if (!(MEDIA_SIZES as readonly string[]).includes(size)) return reply.code(404).send({ error: "Not found" });
    const left = verifyMediaSig(id, size as MediaSize, e, s);
    if (left === null) return reply.code(403).send({ error: "This link has expired" });

    const row = (await query<{ family_id: string; immich_asset_id: string; original_name: string; kind: string }>(
      "SELECT family_id, immich_asset_id, original_name, kind FROM media WHERE id = $1", [id])).rows[0];
    if (!row || (size === "video" && row.kind !== "video")) return reply.code(404).send({ error: "Not found" });
    const conn = await familyConnCached(row.family_id);
    if (!conn) return reply.code(503).send({ error: "Photos are unavailable: this family isn't connected to Immich" });

    let res: Response;
    try {
      res = await fetchMedia(conn, row.immich_asset_id, size as MediaSize, {
        range: req.headers.range, ifNoneMatch: req.headers["if-none-match"],
      });
    } catch (err) {
      return reply.code(502).send({ error: err instanceof ImmichError ? err.message : "Immich didn't answer" });
    }
    if (res.status === 400 || res.status === 404) {
      await res.body?.cancel();
      return reply.code(404).send({ error: "This photo isn't available from Immich (it may still be processing, or it was deleted)" });
    }
    if (res.status >= 500 || res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      req.log.warn({ status: res.status, mediaId: id }, "Immich refused a media request");
      return reply.code(502).send({ error: "Immich couldn't provide this photo" });
    }

    reply.code(res.status);
    for (const h of PASS_HEADERS) {
      const v = res.headers.get(h);
      if (v) reply.header(h, v);
    }
    if (size === "original") {
      reply.header("Cache-Control", "private, no-store");
      reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.original_name || "photo")}`);
    } else {
      // The link is valid for `left` seconds; the bytes never change for a given link.
      reply.header("Cache-Control", `private, max-age=${Math.min(left, 30 * 3600)}`);
    }
    reply.header("X-Content-Type-Options", "nosniff");
    if (res.status === 304 || !res.body) return reply.send();
    return reply.send(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream));
  });
}
