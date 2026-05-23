import bcrypt from "bcryptjs";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface AuthUser {
  id: string;
  familyId: string;
  role: "owner" | "member";
}

// Augment Fastify's JWT payload typing.
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Fastify preHandler that rejects unauthenticated requests. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    await reply.code(401).send({ error: "Unauthorized" });
  }
}
