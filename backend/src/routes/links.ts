import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { createLink, deleteLink, listLinks } from "../lib/links.js";
import { scopeOf } from "../lib/access.js";
import { notFound } from "../lib/errors.js";

const createSchema = z.object({
  from: z.string().min(3),
  to: z.string().min(3),
  role: z.string().max(60).optional(),
});

export async function linkRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/links", async (req, reply) => {
    const b = createSchema.parse(req.body);
    return reply.code(201).send(await createLink(scopeOf(req), b.from, b.to, b.role ?? ""));
  });

  app.get("/api/links", async (req) => {
    const { entity } = z.object({ entity: z.string().min(3).max(100) }).parse(req.query);
    return listLinks(scopeOf(req), entity);
  });

  app.delete("/api/links/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!(await deleteLink(req.user.familyId, id))) throw notFound("Link not found");
    return reply.code(204).send();
  });
}
