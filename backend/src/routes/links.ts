import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { createLink, deleteLink, listLinks } from "../lib/links.js";

const createSchema = z.object({
  from: z.string().min(3),
  to: z.string().min(3),
  role: z.string().max(60).optional(),
});

export async function linkRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/links", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await createLink(
      req.user.familyId, req.user.id, parsed.data.from, parsed.data.to, parsed.data.role ?? "",
    );
    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    return reply.code(201).send(result.link);
  });

  app.get("/api/links", async (req, reply) => {
    const entity = (req.query as { entity?: string }).entity;
    if (!entity) return reply.code(400).send({ error: "entity query param required" });
    const links = await listLinks(req.user.familyId, entity);
    if (links === null) return reply.code(400).send({ error: "Invalid entity reference" });
    return links;
  });

  app.delete("/api/links/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const ok = await deleteLink(req.user.familyId, id);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });
}
