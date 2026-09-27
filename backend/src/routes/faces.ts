import { Readable } from "node:stream";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { assertRefs, loadReadable, scopeOf } from "../lib/access.js";
import { requireAuth } from "../lib/auth.js";
import { notFound } from "../lib/errors.js";
import { fetchPersonThumbnail, ImmichError, immich } from "../lib/immich/client.js";
import { reconcilePerson } from "../lib/immich/faces.js";
import { familyConnCached } from "../lib/immich/provision.js";
import { signFaceUrl, verifyFaceSig } from "../lib/media/urls.js";
import { uuid } from "../lib/validate.js";

/**
 * The faces Immich found in a family's photos, and which Werejugo person each
 * one is. Mapping a face tags every photo it's in (lib/immich/faces.ts).
 */

/** A face waits for review once it's in this many photos. */
export const REVIEW_MIN_PHOTOS = 2;

interface FaceRow {
  id: string; family_id: string; immich_person_id: string; name: string; photo_count: number | null;
  hidden_in_immich: boolean; ignored: boolean; person_id: string | null; first_seen_at: string;
  person_name: string | null; person_family_id: string | null; person_family_name: string | null;
}

const FACE_SELECT = `SELECT ip.*, p.display_name AS person_name, p.family_id AS person_family_id, pf.name AS person_family_name
  FROM immich_people ip LEFT JOIN people p ON p.id = ip.person_id LEFT JOIN families pf ON pf.id = p.family_id`;

function faceDto(r: FaceRow, myFamilyId: string) {
  return {
    id: r.id,
    name: r.name,
    thumbUrl: signFaceUrl(r.id),
    photoCount: r.photo_count,
    ignored: r.ignored,
    hiddenInImmich: r.hidden_in_immich,
    firstSeenAt: r.first_seen_at,
    person: r.person_id
      ? { id: r.person_id, displayName: r.person_name ?? "", familyName: r.person_family_id !== myFamilyId ? r.person_family_name : null }
      : null,
  };
}

const REVIEW = `ip.person_id IS NULL AND NOT ip.ignored AND NOT ip.hidden_in_immich AND COALESCE(ip.photo_count, 0) >= ${REVIEW_MIN_PHOTOS}`;
const VIEWS: Record<string, string> = {
  review: `${REVIEW} ORDER BY ip.photo_count DESC NULLS LAST, ip.first_seen_at, ip.id`,
  mapped: "ip.person_id IS NOT NULL ORDER BY p.display_name, ip.photo_count DESC NULLS LAST, ip.id",
  ignored: "ip.person_id IS NULL AND (ip.ignored OR ip.hidden_in_immich) ORDER BY ip.photo_count DESC NULLS LAST, ip.id",
  all: "true ORDER BY ip.photo_count DESC NULLS LAST, ip.id",
};

async function loadFace(familyId: string, id: string): Promise<FaceRow> {
  const row = (await query<FaceRow>(`${FACE_SELECT} WHERE ip.id = $1 AND ip.family_id = $2`, [id, familyId])).rows[0];
  if (!row) throw notFound("Face not found");
  return row;
}

export async function faceRoutes(app: FastifyInstance): Promise<void> {
  // The thumbnail is served to <img> tags: the signed link is the permission.
  app.get("/api/f/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { e, s } = req.query as { e?: string; s?: string };
    const left = verifyFaceSig(id, e, s);
    if (left === null) return reply.code(403).send({ error: "This link has expired" });
    const row = (await query<{ family_id: string; immich_person_id: string }>("SELECT family_id, immich_person_id FROM immich_people WHERE id = $1", [id])).rows[0];
    if (!row) return reply.code(404).send({ error: "Not found" });
    const conn = await familyConnCached(row.family_id);
    if (!conn) return reply.code(503).send({ error: "Faces are unavailable: this family isn't connected to Immich" });
    let res: Response;
    try {
      res = await fetchPersonThumbnail(conn, row.immich_person_id, { ifNoneMatch: req.headers["if-none-match"] });
    } catch (err) {
      return reply.code(502).send({ error: err instanceof ImmichError ? err.message : "Immich didn't answer" });
    }
    if (!res.ok && res.status !== 304) {
      await res.body?.cancel();
      return reply.code(404).send({ error: "This face has no picture in Immich yet" });
    }
    reply.code(res.status);
    for (const h of ["content-type", "content-length", "etag", "last-modified"]) {
      const v = res.headers.get(h);
      if (v) reply.header(h, v);
    }
    reply.header("Cache-Control", `private, max-age=${Math.min(left, 30 * 3600)}`);
    reply.header("X-Content-Type-Options", "nosniff");
    if (res.status === 304 || !res.body) return reply.send();
    return reply.send(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream));
  });

  app.register(async (inner) => {
    inner.addHook("preHandler", requireAuth);

    inner.get("/api/faces", async (req) => {
      const { view } = z.object({ view: z.enum(["review", "mapped", "ignored", "all"]).default("review") }).parse(req.query);
      const rows = (await query<FaceRow>(`${FACE_SELECT} WHERE ip.family_id = $1 AND ${VIEWS[view]} LIMIT 1000`, [req.user.familyId])).rows;
      return rows.map((r) => faceDto(r, req.user.familyId));
    });

    // How many faces are waiting (the People badge).
    inner.get("/api/faces/count", async (req) => {
      const n = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM immich_people ip WHERE ip.family_id = $1 AND ${REVIEW}`, [req.user.familyId])).rows[0].n;
      return { review: n };
    });

    // Say who a face is (or that it's nobody to keep). Tags follow at once.
    inner.patch("/api/faces/:id", async (req) => {
      const b = z.object({ personId: uuid.nullable().optional(), ignored: z.boolean().optional() }).parse(req.body);
      const scope = scopeOf(req);
      const face = await loadFace(scope.familyId, (req.params as { id: string }).id);
      // Anyone the family can use: its own people, and another family's it can see.
      if (b.personId) await assertRefs(scope, { person: b.personId });
      const previous = face.person_id;
      const next = b.personId !== undefined ? b.personId : b.ignored ? null : previous;
      const ignored = b.ignored ?? (b.personId ? false : face.ignored);
      await query("UPDATE immich_people SET person_id = $3, ignored = $4 WHERE id = $1 AND family_id = $2", [face.id, scope.familyId, next, ignored]);

      let tagged = 0;
      let untagged = 0;
      const conn = await familyConnCached(scope.familyId);
      for (const personId of new Set([previous, next].filter((p): p is string => !!p))) {
        const r = await reconcilePerson(scope.familyId, personId, conn ?? undefined);
        tagged += r.tagged;
        untagged += r.untagged;
      }
      // A face with no name in Immich takes the person's, so Immich's own app shows it too.
      if (next && !face.name && conn) {
        const name = (await query<{ display_name: string }>("SELECT display_name FROM people WHERE id = $1", [next])).rows[0]?.display_name;
        if (name) {
          await immich.renamePerson(conn, face.immich_person_id, name).then(
            () => query("UPDATE immich_people SET name = $2 WHERE id = $1", [face.id, name]),
            () => {},
          );
        }
      }
      return { face: faceDto(await loadFace(scope.familyId, face.id), scope.familyId), tagged, untagged };
    });

    // A new Werejugo person from a face.
    inner.post("/api/faces/:id/person", async (req, reply) => {
      const b = z.object({ displayName: z.string().trim().min(1).max(120) }).parse(req.body);
      const scope = scopeOf(req);
      const face = await loadFace(scope.familyId, (req.params as { id: string }).id);
      const person = (await query<{ id: string }>(
        "INSERT INTO people (family_id, display_name) VALUES ($1, $2) RETURNING id", [scope.familyId, b.displayName])).rows[0];
      await query("UPDATE immich_people SET person_id = $3, ignored = false WHERE id = $1 AND family_id = $2", [face.id, scope.familyId, person.id]);
      const conn = await familyConnCached(scope.familyId);
      const r = await reconcilePerson(scope.familyId, person.id, conn ?? undefined);
      if (!face.name && conn) {
        await immich.renamePerson(conn, face.immich_person_id, b.displayName).then(
          () => query("UPDATE immich_people SET name = $2 WHERE id = $1", [face.id, b.displayName]),
          () => {},
        );
      }
      return reply.code(201).send({ face: faceDto(await loadFace(scope.familyId, face.id), scope.familyId), personId: person.id, tagged: r.tagged });
    });

    // The faces mapped to a person (their page shows them).
    inner.get("/api/people/:id/faces", async (req) => {
      await loadReadable("person", (req.params as { id: string }).id, scopeOf(req));
      const rows = (await query<FaceRow>(`${FACE_SELECT} WHERE ip.family_id = $1 AND ip.person_id = $2 ORDER BY ip.photo_count DESC NULLS LAST`,
        [req.user.familyId, (req.params as { id: string }).id])).rows;
      return rows.map((r) => faceDto(r, req.user.familyId));
    });
  });
}
