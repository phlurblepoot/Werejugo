import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { query } from "../db/pool.js";

export type Role = "owner" | "member";

/** What a login token carries. */
export interface TokenClaims {
  id: string;
  /** The family this session acts in (another family while an admin is "viewing as"). */
  familyId: string;
  role: Role;
  /** users.token_version when the token was issued; a mismatch means it was revoked. */
  tv?: number;
  /** Present while a server admin is viewing another family. */
  adminView?: { homeFamilyId: string };
  /** Set on download tickets: only good for that one download, never as a login. */
  purpose?: DownloadPurpose;
}

/** Big downloads the browser fetches by URL (so they stream to disk, not into memory). */
export type DownloadPurpose = "backup" | "family-export";

/** The authenticated user as routes see it: token claims refreshed from the database. */
export interface AuthUser extends TokenClaims {
  isAdmin: boolean;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenClaims;
    user: AuthUser;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Issue a login token for a user row (its current token_version). */
export function signToken(
  app: FastifyInstance | FastifyReply,
  u: { id: string; family_id: string; role: Role; token_version: number },
  adminView?: { homeFamilyId: string; familyId: string },
): string {
  const claims: TokenClaims = {
    id: u.id,
    familyId: adminView ? adminView.familyId : u.family_id,
    role: adminView ? "owner" : u.role,
    tv: u.token_version,
    ...(adminView ? { adminView: { homeFamilyId: adminView.homeFamilyId } } : {}),
  };
  const jwt = "jwt" in app ? app.jwt : (app as FastifyReply).server.jwt;
  return jwt.sign(claims);
}

interface SessionRow {
  family_id: string;
  role: Role;
  is_admin: boolean;
  token_version: number;
  user_disabled: boolean;
  family_disabled: boolean;
  target_family_exists: boolean;
}

const ENDED = "Your session has ended — please sign in again";

/**
 * preHandler: verify the token AND the account behind it. The account's role
 * and admin flag come from the database, so role changes, disabling and
 * "sign out everywhere" (token_version) take effect on the next request.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    await reply.code(401).send({ error: "Unauthorized" });
    return;
  }
  // A download ticket in an Authorization header is not a login.
  if (req.user.purpose) {
    await reply.code(401).send({ error: "Unauthorized" });
    return;
  }
  await checkSession(req, reply);
}

/**
 * preHandler for a big download: a normal login, or a short-lived ticket for
 * exactly this download in `?ticket=` (the browser follows a plain link, so the
 * file streams to disk). Either way the account is checked like requireAuth.
 */
export function requireAuthOrTicket(purpose: DownloadPurpose) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ticket = (req.query as { ticket?: unknown } | undefined)?.ticket;
    if (typeof ticket !== "string") return requireAuth(req, reply);
    try {
      req.user = req.server.jwt.verify<TokenClaims>(ticket) as AuthUser;
    } catch {
      await reply.code(401).send({ error: "This download link has expired — start the download again" });
      return;
    }
    if (req.user.purpose !== purpose) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    await checkSession(req, reply);
  };
}

/** A two-minute ticket for one download, carrying the caller's session. */
export function signDownloadTicket(app: FastifyInstance, user: AuthUser, purpose: DownloadPurpose): string {
  const claims: TokenClaims = {
    id: user.id, familyId: user.familyId, role: user.role, tv: user.tv, purpose,
    ...(user.adminView ? { adminView: user.adminView } : {}),
  };
  return app.jwt.sign(claims, { expiresIn: "2m" });
}

async function checkSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const claims = req.user;
  const { rows } = await query<SessionRow>(
    `SELECT u.family_id, u.role, u.is_admin, u.token_version,
            u.disabled_at IS NOT NULL AS user_disabled,
            f.disabled_at IS NOT NULL AS family_disabled,
            EXISTS (SELECT 1 FROM families t WHERE t.id = $2) AS target_family_exists
       FROM users u JOIN families f ON f.id = u.family_id
      WHERE u.id = $1`,
    [claims.id, claims.familyId],
  );
  const s = rows[0];
  if (!s || s.user_disabled || (claims.tv ?? 0) !== s.token_version) {
    await reply.code(401).send({ error: ENDED });
    return;
  }
  if (claims.adminView) {
    // Stepping into another family is only valid while the user is still an admin.
    if (!s.is_admin || claims.adminView.homeFamilyId !== s.family_id || !s.target_family_exists) {
      await reply.code(401).send({ error: ENDED });
      return;
    }
    req.user = { ...claims, role: "owner", isAdmin: true };
    return;
  }
  if (claims.familyId !== s.family_id) {
    await reply.code(401).send({ error: ENDED });
    return;
  }
  if (s.family_disabled && !s.is_admin) {
    await reply.code(403).send({ error: "This family's account has been disabled by the server admin" });
    return;
  }
  req.user = { ...claims, role: s.role, isAdmin: s.is_admin };
}

/** preHandler (after requireAuth): server admins only. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user?.isAdmin) await reply.code(403).send({ error: "Only the server admin can do this" });
}

/** preHandler (after requireAuth): family owners (and admins viewing the family). */
export async function requireOwner(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.user?.role !== "owner") await reply.code(403).send({ error: "Only a family owner can do this" });
}
