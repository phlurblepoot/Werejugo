import type { FastifyReply, FastifyRequest } from "fastify";
import { query } from "../db/pool.js";
import type { AuthUser } from "./auth.js";

// Stopgap until Phase 1.3 introduces a real server-admin role: the owner of the
// oldest family "owns the server" and is the only one allowed to back up or
// restore the whole instance.

export async function instanceFamilyId(): Promise<string | null> {
  const { rows } = await query<{ id: string }>("SELECT id FROM families ORDER BY created_at ASC, id ASC LIMIT 1");
  return rows[0]?.id ?? null;
}

export async function isInstanceOwner(user: Pick<AuthUser, "familyId" | "role">): Promise<boolean> {
  return user.role === "owner" && (await instanceFamilyId()) === user.familyId;
}

/** preHandler (after requireAuth): only the server owner may continue. */
export async function requireInstanceOwner(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(await isInstanceOwner(req.user))) {
    await reply.code(403).send({ error: "Only the server owner can do this" });
  }
}
