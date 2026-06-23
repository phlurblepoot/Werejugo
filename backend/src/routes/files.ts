import { createReadStream } from "node:fs";
import { normalize } from "node:path";
import type { FastifyInstance } from "fastify";
import { absStoragePath, storedExists } from "../lib/storage.js";
import { verifyFileToken } from "../lib/filesign.js";

// Private file serving. No requireAuth hook — access is granted by a valid
// signed token in the query string, so <img> tags work without headers.
export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/files/*", async (req, reply) => {
    const relPath = decodeURIComponent((req.params as { "*": string })["*"]);
    const { exp, sig } = req.query as { exp?: string; sig?: string };

    // Reject traversal: the normalized path must stay within storage.
    if (relPath.includes("..") || normalize(relPath).startsWith("..")) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    if (!exp || !sig || !verifyFileToken(relPath, exp, sig)) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    if (!(await storedExists(absStoragePath(relPath)))) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.send(createReadStream(absStoragePath(relPath)));
  });
}
