import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAuth } from "../lib/auth.js";
import { loadEditable, loadReadable, readableWhere, scopeOf } from "../lib/access.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { signMediaUrl } from "../lib/media/urls.js";
import { uuid } from "../lib/validate.js";

interface LinkRow {
  id: string; status: string; created_at: Date;
  mine_id: string; mine_name: string; other_id: string; other_name: string; other_family: string; incoming: boolean;
}

/** "Our Grandma is your Grandma": link the same person across two families that share a trip. */
export async function personLinkRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/person-links", async (req) => {
    const fam = req.user.familyId;
    const { rows } = await query<LinkRow>(
      `SELECT l.id, l.status, l.created_at,
              mine.id AS mine_id, mine.display_name AS mine_name,
              other.id AS other_id, other.display_name AS other_name, f.name AS other_family,
              (mine.id = l.person_b) AS incoming
         FROM person_links l
         JOIN people mine ON mine.id IN (l.person_a, l.person_b) AND mine.family_id = $1
         JOIN people other ON other.id IN (l.person_a, l.person_b) AND other.id <> mine.id
         JOIN families f ON f.id = other.family_id
        ORDER BY l.created_at DESC`, [fam]);
    const dto = (r: LinkRow) => ({
      id: r.id, status: r.status, createdAt: r.created_at, incoming: r.incoming,
      person: { id: r.mine_id, displayName: r.mine_name },
      other: { id: r.other_id, displayName: r.other_name, familyName: r.other_family },
    });
    return {
      incoming: rows.filter((r) => r.status === "pending" && r.incoming).map(dto),
      outgoing: rows.filter((r) => r.status === "pending" && !r.incoming).map(dto),
      linked: rows.filter((r) => r.status === "accepted").map(dto),
    };
  });

  app.post("/api/person-links", async (req, reply) => {
    const b = z.object({ personId: uuid, otherPersonId: uuid }).parse(req.body);
    const scope = scopeOf(req);
    await loadEditable("person", b.personId, scope); // one of ours
    // …and someone from a family we share a trip with.
    const other = await loadReadable<{ family_id: string }>("person", b.otherPersonId, scope);
    if (other.family_id === scope.familyId) throw badRequest("Both people are in your family — pick someone from another family");
    try {
      const { rows } = await query<{ id: string }>(
        "INSERT INTO person_links (person_a, person_b, requested_by) VALUES ($1, $2, $3) RETURNING id",
        [b.personId, b.otherPersonId, scope.userId]);
      return reply.code(201).send({ id: rows[0].id, status: "pending" });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw conflict("These two are already linked, or a request is waiting");
      throw err;
    }
  });

  // The other family agrees it's the same person.
  app.post("/api/person-links/:id/accept", async (req) => {
    const id = (req.params as { id: string }).id;
    const { rowCount } = await query(
      `UPDATE person_links l SET status = 'accepted', responded_at = now()
        FROM people b WHERE l.id = $1 AND l.status = 'pending' AND b.id = l.person_b AND b.family_id = $2`,
      [id, req.user.familyId]);
    if (!rowCount) throw notFound("Link request not found");
    return { ok: true };
  });

  // Either family can decline, withdraw or undo a link.
  app.delete("/api/person-links/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const { rowCount } = await query(
      `DELETE FROM person_links l USING people p
        WHERE l.id = $1 AND p.id IN (l.person_a, l.person_b) AND p.family_id = $2`, [id, req.user.familyId]);
    if (!rowCount) throw notFound("Link not found");
    return reply.code(204).send();
  });

  /** Everyone's people on a trip — to tag on shared places and to link across families. */
  app.get("/api/trips/:id/people", async (req) => {
    const id = (req.params as { id: string }).id;
    const scope = scopeOf(req);
    await loadReadable("trip", id, scope);
    const { rows } = await query<{ id: string; display_name: string; family_id: string; family_name: string; avatar_id: string | null }>(
      `SELECT p.id, p.display_name, p.family_id, f.name AS family_name, m.id AS avatar_id
         FROM people p JOIN families f ON f.id = p.family_id
         LEFT JOIN media m ON m.id = p.avatar_media_id AND m.family_id = p.family_id
        WHERE (p.family_id = (SELECT family_id FROM trips WHERE id = $1)
               OR p.family_id IN (SELECT family_id FROM trip_members WHERE trip_id = $1))
          AND ${readableWhere("person", "p", "$2")}
        ORDER BY (p.family_id = $2) DESC, f.name, p.display_name`, [id, scope.familyId]);
    return rows.map((r) => ({
      id: r.id, displayName: r.display_name, familyId: r.family_id, familyName: r.family_name, mine: r.family_id === scope.familyId,
      avatarUrl: r.avatar_id ? signMediaUrl(r.avatar_id, "thumbnail") : null,
    }));
  });
}
