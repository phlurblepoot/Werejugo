import { createHash, randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";

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
export interface FakeAsset {
  id: string;
  ownerId: string;
  type: "IMAGE" | "VIDEO";
  originalFileName: string;
  mime: string;
  bytes: Buffer;
  checksum: string;
  fileCreatedAt: string;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  visibility: "timeline" | "archive" | "hidden" | "locked";
  description: string;
  latitude: number | null;
  longitude: number | null;
  dateTimeOriginal: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}
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
  assets: Map<string, FakeAsset>;
  /** A photo or video added in Immich directly (not through Werejugo). */
  addAsset(ownerId: string, a?: Partial<FakeAsset>): FakeAsset;
  /** Delete for good (as after Immich empties its trash). */
  purgeAsset(id: string): void;
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

function assetDto(a: FakeAsset, withExif = true) {
  return {
    id: a.id, ownerId: a.ownerId, type: a.type, originalFileName: a.originalFileName, originalMimeType: a.mime,
    originalPath: `/data/upload/${a.ownerId}/${a.id}`, checksum: a.checksum, thumbhash: "AAAA",
    fileCreatedAt: a.fileCreatedAt, fileModifiedAt: a.fileCreatedAt, localDateTime: a.dateTimeOriginal ?? a.fileCreatedAt,
    createdAt: a.createdAt, updatedAt: a.updatedAt, isTrashed: a.trashedAt !== null, isArchived: a.visibility === "archive",
    isFavorite: false, isOffline: false, isEdited: false, hasMetadata: true, visibility: a.visibility,
    width: a.width, height: a.height, duration: a.durationMs !== null ? a.durationMs : 0, duplicateId: null, livePhotoVideoId: null,
    ...(withExif ? {
      exifInfo: {
        description: a.description, latitude: a.latitude, longitude: a.longitude, dateTimeOriginal: a.dateTimeOriginal,
        exifImageWidth: a.width, exifImageHeight: a.height, fileSizeInByte: a.bytes.length, city: null, country: null, state: null,
      },
    } : {}),
  };
}

type DateOp = { eq?: string; gt?: string; gte?: string; lt?: string; lte?: string; ne?: string | null };
function dateMatches(value: string | null, f: DateOp | undefined): boolean {
  if (!f) return true;
  if (value === null) return f.ne === null ? false : !Object.keys(f).length;
  const v = Date.parse(value);
  if (f.eq !== undefined && v !== Date.parse(f.eq)) return false;
  if (f.gt !== undefined && !(v > Date.parse(f.gt))) return false;
  if (f.gte !== undefined && !(v >= Date.parse(f.gte))) return false;
  if (f.lt !== undefined && !(v < Date.parse(f.lt))) return false;
  if (f.lte !== undefined && !(v <= Date.parse(f.lte))) return false;
  return true;
}

/** File name extensions Immich accepts (a subset of its list, enough for tests). */
const SUPPORTED_UPLOAD = /\.(jpe?g|png|gif|webp|heic|heif|avif|tiff?|dng|cr2|cr3|nef|arw|raf|orf|rw2|mp4|mov|m4v|webm|avi|mkv|3gp|mts)$/i;

/** Serve bytes the way Immich does: ETag, Accept-Ranges, 304 and 206. */
function sendBytes(req: FastifyRequest, reply: FastifyReply, a: FakeAsset, mime: string, attachment: boolean) {
  const etag = `"${a.checksum}-${a.updatedAt.length}"`;
  reply.header("ETag", etag).header("Accept-Ranges", "bytes").header("Cache-Control", "private, max-age=86400, no-transform");
  if (attachment) reply.header("Content-Disposition", `attachment; filename="${a.originalFileName}"`);
  // Real Immich ignores If-None-Match for originals (200 with the file); thumbnails answer 304 here.
  if (!attachment && req.headers["if-none-match"] === etag) return reply.code(304).send();
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (m) {
    const size = a.bytes.length;
    const start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
    const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start > end || start >= size) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    return reply.code(206).header("Content-Range", `bytes ${start}-${end}/${size}`).type(mime).send(a.bytes.subarray(start, end + 1));
  }
  return reply.type(mime).send(a.bytes);
}
const fail = (reply: FastifyReply, statusCode: number, message: string) =>
  reply.code(statusCode).send({ message, error: { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden" }[statusCode] ?? "Error", statusCode });

export async function startFakeImmich(opts: { version?: FakeImmich["version"]; port?: number; adminKey?: string } = {}): Promise<FakeImmich> {
  const users = new Map<string, User>();
  const keys = new Map<string, ApiKey>();
  const sessions = new Map<string, string>(); // token -> userId
  const failures = new Map<string, number>();
  const calls: string[] = [];
  const assets = new Map<string, FakeAsset>();

  const mkAsset = (ownerId: string, a: Partial<FakeAsset> = {}): FakeAsset => {
    const bytes = a.bytes ?? Buffer.from(`fake-image-${randomUUID()}`);
    const asset: FakeAsset = {
      id: randomUUID(), ownerId, type: "IMAGE", originalFileName: "IMG_0001.jpg", mime: "image/jpeg",
      checksum: createHash("sha1").update(bytes).digest("base64"), fileCreatedAt: now(), createdAt: now(), updatedAt: now(),
      trashedAt: null, visibility: "timeline", description: "", latitude: null, longitude: null, dateTimeOriginal: null,
      width: 4032, height: 3024, durationMs: null,
      ...a, bytes,
    };
    assets.set(asset.id, asset);
    return asset;
  };
  const touch = (a: FakeAsset) => { a.updatedAt = new Date(Math.max(Date.now(), Date.parse(a.updatedAt) + 1)).toISOString(); };

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
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });

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

  // ---- Assets ----
  const ownAsset = (c: Caller, id: string) => {
    const a = assets.get(id);
    return a && a.ownerId === c.user.id ? a : null;
  };

  app.post("/api/assets", async (req, reply) => {
    if (!enter("uploadAsset", reply)) return reply;
    const c = auth(req, reply, "asset.upload");
    if (!c) return reply;
    const fields: Record<string, string> = {};
    let file: { buf: Buffer; filename: string; mime: string } | null = null;
    for await (const part of req.parts()) {
      if (part.type === "file") file = { buf: await part.toBuffer(), filename: part.filename, mime: part.mimetype };
      else if (typeof part.value === "string") fields[part.fieldname] = part.value;
    }
    if (!file || !fields.fileCreatedAt || !fields.fileModifiedAt) return fail(reply, 400, "assetData, fileCreatedAt and fileModifiedAt are required");
    // Like Immich: the upload's own file name decides whether the type is supported.
    if (!SUPPORTED_UPLOAD.test(file.filename)) return fail(reply, 400, `Unsupported file type ${file.filename}`);
    const checksum = createHash("sha1").update(file.buf).digest("base64");
    const dup = [...assets.values()].find((a) => a.ownerId === c.user.id && a.checksum === checksum);
    if (dup) return reply.code(200).send({ id: dup.id, status: "duplicate" });
    const name = fields.filename || file.filename;
    const video = /\.(mp4|mov|m4v|webm)$/i.test(name) || file.mime.startsWith("video/");
    const a = mkAsset(c.user.id, {
      bytes: file.buf, originalFileName: name, mime: video ? "video/mp4" : file.mime === "application/octet-stream" ? "image/jpeg" : file.mime,
      type: video ? "VIDEO" : "IMAGE", fileCreatedAt: new Date(fields.fileCreatedAt).toISOString(), durationMs: video ? 12_345 : null,
    });
    return reply.code(201).send({ id: a.id, status: "created" });
  });

  app.get("/api/assets/:id", async (req, reply) => {
    if (!enter("getAsset", reply)) return reply;
    const c = auth(req, reply, "asset.read");
    if (!c) return reply;
    const a = ownAsset(c, (req.params as { id: string }).id);
    return a ? assetDto(a) : fail(reply, 400, "Not found or no asset.read access");
  });

  app.put("/api/assets/:id", async (req, reply) => {
    if (!enter("setDescription", reply)) return reply;
    const c = auth(req, reply, "asset.update");
    if (!c) return reply;
    const a = ownAsset(c, (req.params as { id: string }).id);
    if (!a) return fail(reply, 400, "Not found or no asset.update access");
    const b = (req.body ?? {}) as { description?: string };
    if (b.description !== undefined) a.description = b.description;
    touch(a);
    return assetDto(a);
  });

  app.delete("/api/assets", async (req, reply) => {
    if (!enter("trashAssets", reply)) return reply;
    const c = auth(req, reply, "asset.delete");
    if (!c) return reply;
    const b = (req.body ?? {}) as { ids?: string[]; force?: boolean };
    for (const id of b.ids ?? []) {
      const a = ownAsset(c, id);
      if (!a) continue;
      if (b.force) assets.delete(id);
      else { a.trashedAt = now(); touch(a); }
    }
    return reply.code(204).send();
  });

  app.post("/api/search/metadata", async (req, reply) => {
    if (!enter("searchAssets", reply)) return reply;
    const c = auth(req, reply, "asset.read");
    if (!c) return reply;
    const b = (req.body ?? {}) as { filter?: Record<string, unknown>; cursor?: string; size?: number; withExif?: boolean };
    const f = (b.filter ?? {}) as { updatedAt?: DateOp; trashedAt?: DateOp; id?: { eq?: string }; visibility?: { eq?: string; in?: string[] } };
    const size = Math.min(b.size ?? 250, 1000);
    const offset = b.cursor ? Number(Buffer.from(b.cursor, "base64url").toString()) : 0;
    const matching = [...assets.values()]
      .filter((a) => a.ownerId === c.user.id)
      // Like Immich: trashed assets only when the filter asks about trashedAt.
      .filter((a) => (f.trashedAt ? a.trashedAt !== null && dateMatches(a.trashedAt, f.trashedAt) : a.trashedAt === null))
      .filter((a) => dateMatches(a.updatedAt, f.updatedAt))
      .filter((a) => !f.id?.eq || a.id === f.id.eq)
      .filter((a) => (f.visibility?.eq ? a.visibility === f.visibility.eq : f.visibility?.in ? f.visibility.in.includes(a.visibility) : a.visibility !== "hidden" && a.visibility !== "locked"))
      .sort((x, y) => (y.fileCreatedAt.localeCompare(x.fileCreatedAt)) || x.id.localeCompare(y.id));
    const page = matching.slice(offset, offset + size);
    const next = offset + size < matching.length ? Buffer.from(String(offset + size)).toString("base64url") : null;
    return {
      assets: { items: page.map((a) => assetDto(a, b.withExif ?? false)), count: page.length, nextCursor: next, nextPage: null, total: matching.length, facets: [] },
      albums: { items: [], count: 0, total: 0, facets: [] },
    };
  });

  const serve = (op: string, mimeOf: (a: FakeAsset) => string, attachment = false) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!enter(op, reply)) return reply;
    const c = auth(req, reply, op === "original" ? "asset.download" : "asset.view");
    if (!c) return reply;
    const a = ownAsset(c, (req.params as { id: string }).id);
    if (!a) return fail(reply, 400, "Not found or no asset.view access");
    return sendBytes(req, reply, a, mimeOf(a), attachment);
  };
  // Real Immich sends a resized WebP/JPEG; the stand-in sends the original bytes, labelled truthfully.
  app.get("/api/assets/:id/thumbnail", serve("thumbnail", (a) => (a.type === "VIDEO" ? "image/jpeg" : a.mime)));
  app.get("/api/assets/:id/original", serve("original", (a) => a.mime, true));
  app.get("/api/assets/:id/video/playback", serve("video", () => "video/mp4"));

  await app.listen({ host: "127.0.0.1", port: opts.port ?? 0 });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const fake: FakeImmich = {
    url: `http://127.0.0.1:${port}`,
    adminKey: adminKey.secret,
    adminEmail: admin.email,
    users, keys, calls, assets,
    addAsset: (ownerId, a) => mkAsset(ownerId, a),
    purgeAsset: (id) => { assets.delete(id); },
    version: opts.version ?? { major: 3, minor: 2, patch: 2, prerelease: null },
    failNext: (op, status) => { failures.set(op, status); },
    addAdminKey: (permissions) => mkKey(admin.id, "limited", permissions).secret,
    close: () => app.close(),
  };
  return fake;
}
