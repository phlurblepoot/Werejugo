import { randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

/**
 * A stand-in Immich for tests and local development. It implements only the
 * calls Werejugo makes, with the request/response shapes, auth rules and error
 * statuses of Immich 3.2.2 (from its OpenAPI spec). `lib/immich/contract.test.ts`
 * runs the same checks against this and against a real Immich in CI, so the two
 * can't drift apart unnoticed.
 */

interface User {
  id: string;
  email: string;
  name: string;
  password: string;
  isAdmin: boolean;
  shouldChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}
interface ApiKey { id: string; userId: string; name: string; secret: string; permissions: string[]; createdAt: string; updatedAt: string }
type Caller = { user: User; key: ApiKey | null };

export interface FakeImmich {
  url: string;
  /** API key of the seeded admin user (all permissions). */
  adminKey: string;
  adminEmail: string;
  users: Map<string, User>;
  keys: Map<string, ApiKey>;
  version: { major: number; minor: number; patch: number; prerelease: number | null };
  /** Make the next call to `op` (e.g. "createApiKey") fail with this status. */
  failNext(op: string, status: number): void;
  /** Add an API key with limited permissions for the seeded admin. */
  addAdminKey(permissions: string[]): string;
  /** Calls received, by operation name. */
  calls: string[];
  close(): Promise<void>;
}

const now = () => new Date().toISOString();

function userDto(u: User) {
  return {
    id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin, avatarColor: "primary",
    createdAt: u.createdAt, updatedAt: u.updatedAt, deletedAt: null, profileChangedAt: u.updatedAt,
    profileImagePath: "", oauthId: "", storageLabel: null, shouldChangePassword: u.shouldChangePassword,
    quotaSizeInBytes: null, quotaUsageInBytes: 0, status: "active", license: null, clusterGroupId: null,
  };
}
const keyDto = (k: ApiKey) => ({ id: k.id, name: k.name, permissions: k.permissions, createdAt: k.createdAt, updatedAt: k.updatedAt });
const fail = (reply: FastifyReply, statusCode: number, message: string) =>
  reply.code(statusCode).send({ message, error: { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden" }[statusCode] ?? "Error", statusCode });

export async function startFakeImmich(opts: { version?: FakeImmich["version"]; port?: number; adminKey?: string } = {}): Promise<FakeImmich> {
  const users = new Map<string, User>();
  const keys = new Map<string, ApiKey>();
  const sessions = new Map<string, string>(); // token -> userId
  const failures = new Map<string, number>();
  const calls: string[] = [];

  const mkUser = (email: string, name: string, password: string, isAdmin: boolean): User => {
    const u: User = { id: randomUUID(), email, name, password, isAdmin, shouldChangePassword: false, createdAt: now(), updatedAt: now() };
    users.set(u.id, u);
    return u;
  };
  const mkKey = (userId: string, name: string, permissions: string[]): ApiKey => {
    const k: ApiKey = { id: randomUUID(), userId, name, secret: randomBytes(24).toString("base64url"), permissions, createdAt: now(), updatedAt: now() };
    keys.set(k.id, k);
    return k;
  };
  const admin = mkUser("admin@immich.test", "Immich Admin", "admin-password", true);
  const adminKey = mkKey(admin.id, "werejugo-tests", ["all"]);
  if (opts.adminKey) adminKey.secret = opts.adminKey;

  const app = Fastify({ logger: false });

  /** Resolve the caller like Immich does: x-api-key header, or a Bearer session token. */
  function auth(req: FastifyRequest, reply: FastifyReply, permission: string | null, adminOnly = false): Caller | null {
    const apiKey = req.headers["x-api-key"];
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    let caller: Caller | null = null;
    if (typeof apiKey === "string") {
      const k = [...keys.values()].find((x) => x.secret === apiKey);
      const u = k && users.get(k.userId);
      if (k && u) caller = { user: u, key: k };
    } else if (bearer) {
      const u = users.get(sessions.get(bearer) ?? "");
      if (u) caller = { user: u, key: null };
    }
    if (!caller) {
      fail(reply, 401, typeof apiKey === "string" ? "Invalid API key" : "Authentication required");
      return null;
    }
    if (adminOnly && !caller.user.isAdmin) {
      fail(reply, 403, "Forbidden");
      return null;
    }
    if (permission && caller.key && !caller.key.permissions.includes("all") && !caller.key.permissions.includes(permission)) {
      fail(reply, 403, `Missing required permission: ${permission}`);
      return null;
    }
    return caller;
  }
  /** Record the call and apply an injected failure, if any. */
  function enter(op: string, reply: FastifyReply): boolean {
    calls.push(op);
    const status = failures.get(op);
    if (status === undefined) return true;
    failures.delete(op);
    fail(reply, status, `Injected failure (${op})`);
    return false;
  }

  app.get("/api/server/ping", async (_req, reply) => (enter("ping", reply) ? { res: "pong" } : reply));
  app.get("/api/server/version", async (_req, reply) => (enter("version", reply) ? fake.version : reply));

  app.get("/api/users/me", async (req, reply) => {
    if (!enter("me", reply)) return reply;
    const c = auth(req, reply, "user.read");
    return c ? userDto(c.user) : reply;
  });
  app.get("/api/api-keys/me", async (req, reply) => {
    if (!enter("currentKey", reply)) return reply;
    const c = auth(req, reply, null);
    if (!c) return reply;
    if (!c.key) return fail(reply, 403, "Not authenticated with an API key");
    return keyDto(c.key);
  });

  app.get("/api/admin/users", async (req, reply) => {
    if (!enter("searchUsers", reply)) return reply;
    return auth(req, reply, "adminUser.read", true) ? [...users.values()].map(userDto) : reply;
  });
  app.get("/api/admin/users/:id", async (req, reply) => {
    if (!enter("getUser", reply)) return reply;
    if (!auth(req, reply, "adminUser.read", true)) return reply;
    const u = users.get((req.params as { id: string }).id);
    return u ? userDto(u) : fail(reply, 400, "User not found");
  });
  app.post("/api/admin/users", async (req, reply) => {
    if (!enter("createUser", reply)) return reply;
    if (!auth(req, reply, "adminUser.create", true)) return reply;
    const b = (req.body ?? {}) as { email?: string; name?: string; password?: string; shouldChangePassword?: boolean };
    if (!b.email || !b.name || !b.password || !/^[^@\s]+@[^@\s]+$/.test(b.email)) return fail(reply, 400, "Invalid user");
    if ([...users.values()].some((u) => u.email.toLowerCase() === b.email!.toLowerCase())) return fail(reply, 400, "User exists");
    const u = mkUser(b.email, b.name, b.password, false);
    u.shouldChangePassword = b.shouldChangePassword ?? true;
    return reply.code(201).send(userDto(u));
  });
  app.put("/api/admin/users/:id", async (req, reply) => {
    if (!enter("updateUser", reply)) return reply;
    if (!auth(req, reply, "adminUser.update", true)) return reply;
    const u = users.get((req.params as { id: string }).id);
    if (!u) return fail(reply, 400, "User not found");
    const b = (req.body ?? {}) as Partial<Pick<User, "name" | "password" | "shouldChangePassword">>;
    if (b.name !== undefined) u.name = b.name;
    if (b.password !== undefined) u.password = b.password;
    if (b.shouldChangePassword !== undefined) u.shouldChangePassword = b.shouldChangePassword;
    u.updatedAt = now();
    return userDto(u);
  });

  app.post("/api/auth/login", async (req, reply) => {
    if (!enter("login", reply)) return reply;
    const b = (req.body ?? {}) as { email?: string; password?: string };
    const u = [...users.values()].find((x) => x.email.toLowerCase() === (b.email ?? "").toLowerCase());
    if (!u || u.password !== b.password) return fail(reply, 401, "Incorrect email or password");
    const token = randomBytes(24).toString("base64url");
    sessions.set(token, u.id);
    return reply.code(201).send({
      accessToken: token, userId: u.id, userEmail: u.email, name: u.name, isAdmin: u.isAdmin,
      isOnboarded: true, profileImagePath: "", shouldChangePassword: u.shouldChangePassword,
    });
  });

  app.post("/api/api-keys", async (req, reply) => {
    if (!enter("createApiKey", reply)) return reply;
    const c = auth(req, reply, "apiKey.create");
    if (!c) return reply;
    const b = (req.body ?? {}) as { name?: string; permissions?: string[] };
    if (!b.permissions?.length) return fail(reply, 400, "permissions must contain at least 1 elements");
    if (c.key && !c.key.permissions.includes("all") && !b.permissions.every((p) => c.key!.permissions.includes(p))) {
      return fail(reply, 400, "Cannot grant permissions you do not have");
    }
    const k = mkKey(c.user.id, b.name ?? "API Key", b.permissions);
    return reply.code(201).send({ ...keyDto(k), secret: k.secret, apiKey: keyDto(k) });
  });
  app.delete("/api/api-keys/:id", async (req, reply) => {
    if (!enter("deleteApiKey", reply)) return reply;
    const c = auth(req, reply, "apiKey.delete");
    if (!c) return reply;
    const k = keys.get((req.params as { id: string }).id);
    if (!k || k.userId !== c.user.id) return fail(reply, 400, "API Key not found");
    keys.delete(k.id);
    return reply.code(204).send();
  });

  await app.listen({ host: "127.0.0.1", port: opts.port ?? 0 });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const fake: FakeImmich = {
    url: `http://127.0.0.1:${port}`,
    adminKey: adminKey.secret,
    adminEmail: admin.email,
    users, keys, calls,
    version: opts.version ?? { major: 3, minor: 2, patch: 2, prerelease: null },
    failNext: (op, status) => { failures.set(op, status); },
    addAdminKey: (permissions) => mkKey(admin.id, "limited", permissions).secret,
    close: () => app.close(),
  };
  return fake;
}
