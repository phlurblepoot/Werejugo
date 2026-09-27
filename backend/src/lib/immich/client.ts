import * as sdk from "@immich/sdk";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ImmichVersion } from "./version.js";

export type { AssetResponseDto as ImmichAsset } from "@immich/sdk";

/**
 * The only place Werejugo talks to Immich. Every call takes the server address
 * and the credential to use (an API key, or a session token right after
 * logging in), so one process can act for many families at once. Failures come
 * back as ImmichError with a message a person can act on.
 */

export interface ImmichConn {
  url: string;
  key?: string;
  token?: string;
}

export type ImmichErrorKind = "unreachable" | "unauthorized" | "forbidden" | "rejected" | "unexpected";

export class ImmichError extends Error {
  constructor(
    public kind: ImmichErrorKind,
    message: string,
    public status: number | null = null,
    public op = "",
  ) {
    super(message);
    this.name = "ImmichError";
  }
}

const TIMEOUT_MS = 10_000;

type RequestOpts = NonNullable<Parameters<typeof sdk.getServerVersion>[0]>;

/** Permissions Werejugo needs on the admin key ("all" includes them). */
export const ADMIN_KEY_PERMISSIONS = ["user.read", "adminUser.create", "adminUser.read", "adminUser.update"] as const;

/** "http://host:2283/", "http://host:2283/api" → "http://host:2283". Throws on anything that isn't http(s). */
export function normalizeImmichUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new ImmichError("rejected", "Enter Immich's address, for example http://192.168.1.10:2283");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ImmichError("rejected", "Immich's address must start with http:// or https://");
  }
  const path = u.pathname.replace(/\/+$/, "").replace(/\/api$/, "");
  return `${u.origin}${path}`;
}

function opts(c: ImmichConn): RequestOpts {
  const headers: Record<string, string> = {};
  if (c.key) headers["x-api-key"] = c.key;
  else if (c.token) headers.Authorization = `Bearer ${c.token}`;
  return { baseUrl: `${c.url}/api`, headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
}

/** An error answer from Immich, as an ImmichError. */
function httpFailure(op: string, status: number, data: unknown): ImmichError {
  // Immich sends a string, or a list of strings for validation errors.
  const raw: unknown = (data as { message?: unknown } | null)?.message;
  const detail = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("; ") : "";
  if (status === 401) return new ImmichError("unauthorized", "Immich rejected the API key (it may have been deleted or mistyped)", status, op);
  if (status === 403) {
    return new ImmichError("forbidden", detail.startsWith("Missing required permission")
      ? `The Immich API key is missing a permission (${detail.replace("Missing required permission: ", "")}). Create a key with all permissions.`
      : "The Immich API key isn't allowed to do this (it must belong to an Immich admin)", status, op);
  }
  return new ImmichError(status >= 500 ? "unexpected" : "rejected", detail || `Immich answered ${status}`, status, op);
}

function explain(op: string, url: string, e: unknown, timeoutMs = TIMEOUT_MS): ImmichError {
  if (e instanceof ImmichError) return e;
  if (sdk.isHttpError(e)) return httpFailure(op, e.status, e.data);
  if (sdk.isMalformedResponseError(e)) {
    return new ImmichError("unexpected", `${url} answered, but not like Immich does. Check the address.`, e.status, op);
  }
  const name = (e as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return new ImmichError("unreachable", `Immich at ${url} didn't answer within ${Math.round(timeoutMs / 1000)} seconds`, null, op);
  }
  return new ImmichError("unreachable", `Werejugo can't reach Immich at ${url}. Check the address and that Immich is running.`, null, op);
}

async function call<T>(op: string, c: ImmichConn, fn: (o: RequestOpts) => Promise<T>): Promise<T> {
  try {
    return await fn(opts(c));
  } catch (e) {
    throw explain(op, c.url, e);
  }
}

export const immich = {
  ping: (url: string) => call("ping", { url }, (o) => sdk.pingServer(o)),
  version: (url: string): Promise<ImmichVersion> => call("version", { url }, (o) => sdk.getServerVersion(o)),
  me: (c: ImmichConn) => call("me", c, (o) => sdk.getMyUser(o)),
  currentKey: (c: ImmichConn) => call("currentKey", c, (o) => sdk.getMyApiKey(o)),
  listUsers: (c: ImmichConn) => call("searchUsers", c, (o) => sdk.searchUsersAdmin({ withDeleted: false }, o)),
  createUser: (c: ImmichConn, dto: { email: string; name: string; password: string }) =>
    call("createUser", c, (o) => sdk.createUserAdmin({ userAdminCreateDto: { ...dto, shouldChangePassword: false, notify: false } }, o)),
  setPassword: (c: ImmichConn, userId: string, password: string) =>
    call("updateUser", c, (o) => sdk.updateUserAdmin({ id: userId, userAdminUpdateDto: { password, shouldChangePassword: false } }, o)),
  login: (url: string, email: string, password: string) =>
    call("login", { url }, (o) => sdk.login({ loginCredentialDto: { email, password } }, o)),
  createApiKey: (c: ImmichConn, name: string) =>
    call("createApiKey", c, (o) => sdk.createApiKey({ apiKeyCreateDto: { name, permissions: [sdk.Permission.All] } }, o)),
  deleteApiKey: (c: ImmichConn, id: string) => call("deleteApiKey", c, (o) => sdk.deleteApiKey({ id }, o)),

  // ---- Assets (a family's photos and videos) ----

  /**
   * Hand a file to Immich. `duplicate` means the same file is already in the
   * account (its id is returned), even when that one is in Immich's trash.
   * Immich decides whether it can take the file from the upload's own file
   * name, so the bytes go as a named File. A file-backed Blob
   * (`fs.openAsBlob`) is streamed, never read into memory.
   */
  uploadAsset: (c: ImmichConn, file: Blob, meta: UploadMeta, opts: { timeoutMs?: number } = {}) =>
    streamUpload(c, file, meta, opts.timeoutMs ?? uploadTimeoutMs(file.size)),
  getAsset: (c: ImmichConn, id: string) => call("getAsset", c, (o) => sdk.getAssetInfo({ id }, o)),
  /** Immich 3.2's structured search: `filter`, cursor paging, optional EXIF in the results. */
  searchAssets: (c: ImmichConn, q: { filter?: sdk.SearchFilter; cursor?: string; size?: number; withExif?: boolean }) =>
    call("searchAssets", c, (o) => sdk.searchAssets({ metadataSearchDto: { ...q } }, o)).then((r) => r.assets),
  /**
   * Smart search (CLIP): assets matching a description, most relevant first,
   * `size` a page. Needs Immich's machine learning; without it, see smartSearchOff.
   */
  smartSearch: (c: ImmichConn, q: { query: string; page?: number; size?: number; type?: "IMAGE" | "VIDEO"; takenAfter?: string; takenBefore?: string }) =>
    call("smartSearch", c, (o) => sdk.searchSmart({ smartSearchDto: { ...q, type: q.type as sdk.AssetTypeEnum | undefined } }, o))
      .then((r) => ({ items: r.assets.items, nextPage: r.assets.nextPage ? Number(r.assets.nextPage) : null })),
  /** Move to Immich's trash (restorable there); never a permanent delete. */
  trashAssets: (c: ImmichConn, ids: string[]) =>
    call("trashAssets", c, (o) => sdk.deleteAssets({ assetBulkDeleteDto: { ids, force: false } }, o)),
  /** Bring assets back from Immich's trash. */
  restoreAssets: (c: ImmichConn, ids: string[]) =>
    call("restoreAssets", c, (o) => sdk.restoreAssets({ bulkIdsDto: { ids } }, o)),
  /** The asset's description (Werejugo's caption). PUT /assets/:id is deprecated in 3.2 but is the only way until 4.0. */
  setDescription: (c: ImmichConn, id: string, description: string) =>
    call("setDescription", c, (o) => sdk.updateAsset({ id, updateAssetDto: { description } }, o)),

  // ---- People (the faces Immich recognised in an account's photos) ----

  /** Every person in the account, hidden ones included. */
  listPeople: async (c: ImmichConn) => {
    const all: sdk.PersonResponseDto[] = [];
    for (let page = 1; page <= 100; page++) {
      const r = await call("listPeople", c, (o) => sdk.getAllPeople({ page, size: 500, withHidden: true }, o));
      all.push(...r.people);
      if (!r.hasNextPage || !r.people.length) break;
    }
    return all;
  },
  /** How many photos a person is in. */
  personStats: (c: ImmichConn, id: string) => call("personStats", c, (o) => sdk.getPersonStatistics({ id }, o)).then((r) => r.assets),
  renamePerson: (c: ImmichConn, id: string, name: string) =>
    call("renamePerson", c, (o) => sdk.updatePerson({ id, personUpdateDto: { name } }, o)),
  /** Which face shows as the person's thumbnail. */
  setPersonFeatureFace: (c: ImmichConn, id: string, assetId: string) =>
    call("setPersonFeatureFace", c, (o) => sdk.updatePerson({ id, personUpdateDto: { featureFaceAssetId: assetId } }, o)),
  /** Making a person and a face by hand (what recognition does): for tests and the contract. */
  createPerson: (c: ImmichConn, name: string) => call("createPerson", c, (o) => sdk.createPerson({ personCreateDto: { name } }, o)),
  createFace: (c: ImmichConn, face: sdk.AssetFaceCreateDto) => call("createFace", c, (o) => sdk.createFace({ assetFaceCreateDto: face }, o)),

  // ---- Albums (one per trip, lib/immich/albums.ts) ----

  /** The albums the account owns (not ones shared with it). No assets: search by album for those. */
  listAlbums: (c: ImmichConn) => call("listAlbums", c, (o) => sdk.getAllAlbums({ isOwned: true }, o)),
  getAlbum: (c: ImmichConn, id: string) => call("getAlbum", c, (o) => sdk.getAlbumInfo({ id }, o)),
  createAlbum: (c: ImmichConn, albumName: string, description: string, assetIds: string[] = []) =>
    call("createAlbum", c, (o) => sdk.createAlbum({ createAlbumDto: { albumName, description, assetIds } }, o)),
  renameAlbum: (c: ImmichConn, id: string, albumName: string) =>
    call("updateAlbum", c, (o) => sdk.updateAlbumInfo({ id, updateAlbumDto: { albumName } }, o)),
  /** The album only: its photos stay in the account. */
  deleteAlbum: (c: ImmichConn, id: string) => call("deleteAlbum", c, (o) => sdk.deleteAlbum({ id }, o)),
  addToAlbum: async (c: ImmichConn, id: string, assetIds: string[]) => {
    for (let i = 0; i < assetIds.length; i += ALBUM_BATCH) {
      const ids = assetIds.slice(i, i + ALBUM_BATCH);
      await call("addToAlbum", c, (o) => sdk.addAssetsToAlbum({ id, bulkIdsDto: { ids } }, o));
    }
  },
  removeFromAlbum: async (c: ImmichConn, id: string, assetIds: string[]) => {
    for (let i = 0; i < assetIds.length; i += ALBUM_BATCH) {
      const ids = assetIds.slice(i, i + ALBUM_BATCH);
      await call("removeFromAlbum", c, (o) => sdk.removeAssetFromAlbum({ id, bulkIdsDto: { ids } }, o));
    }
  },
};

/** Assets added to or removed from an album per request. */
const ALBUM_BATCH = 500;

/** Immich refused a smart search because its machine learning is turned off. */
export const smartSearchOff = (e: unknown) => e instanceof ImmichError && e.status === 400 && /smart search is not enabled/i.test(e.message);

export type ImmichPerson = sdk.PersonResponseDto;
export type ImmichAlbum = sdk.AlbumResponseDto;

interface UploadMeta { filename: string; fileCreatedAt: string; fileModifiedAt: string }

/**
 * POST /api/assets as the SDK's uploadAsset would send it, but streamed with
 * node:http: fetch holds a whole request body in memory, which a 4 GB video
 * can't afford. The file part carries the file's own name, which Immich uses
 * to decide whether it can take the file.
 */
async function streamUpload(c: ImmichConn, file: Blob, meta: UploadMeta, timeoutMs: number): Promise<sdk.AssetMediaResponseDto> {
  const op = "uploadAsset";
  const boundary = `----werejugo${randomBytes(12).toString("hex")}`;
  const name = meta.filename.replace(/["\\\r\n]/g, "_");
  const field = (k: string, v: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  const body = new Blob([
    field("fileCreatedAt", meta.fileCreatedAt) + field("fileModifiedAt", meta.fileModifiedAt) + field("filename", name)
      + `--${boundary}\r\nContent-Disposition: form-data; name="assetData"; filename="${name}"\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
    file,
    `\r\n--${boundary}--\r\n`,
  ]);
  const url = new URL(`${c.url}/api/assets`);
  const headers: Record<string, string> = {
    "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(body.size), accept: "application/json",
  };
  if (c.key) headers["x-api-key"] = c.key;
  else if (c.token) headers.authorization = `Bearer ${c.token}`;

  try {
    return await new Promise<sdk.AssetMediaResponseDto>((resolve, reject) => {
      let answered = false;
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { method: "POST", headers, signal: AbortSignal.timeout(timeoutMs) }, (res) => {
        answered = true;
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("error", reject);
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          let data: unknown = null;
          try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not JSON */ }
          const r = data as Partial<sdk.AssetMediaResponseDto> | null;
          if (status >= 200 && status < 300 && typeof r?.id === "string" && typeof r.status === "string") resolve(r as sdk.AssetMediaResponseDto);
          else if (status >= 200 && status < 300) reject(new ImmichError("unexpected", `${c.url} answered, but not like Immich does. Check the address.`, status, op));
          else reject(httpFailure(op, status, data));
          req.destroy(); // Immich may answer before reading everything (a refused type)
        });
      });
      req.on("error", (e) => { if (!answered) reject(e); });
      pipeline(Readable.fromWeb(body.stream() as import("node:stream/web").ReadableStream), req).catch((e) => { if (!answered) reject(e); });
    });
  } catch (e) {
    throw explain(op, c.url, e, timeoutMs);
  }
}

/** Time to hand a file to Immich over the LAN: 10 minutes, plus a minute per 500 MB. */
export const uploadTimeoutMs = (bytes: number) => 10 * 60_000 + Math.ceil(bytes / (500 * 1024 * 1024)) * 60_000;

export type MediaSize = "thumbnail" | "preview" | "original" | "video";

const MEDIA_PATH: Record<MediaSize, (id: string) => string> = {
  thumbnail: (id) => `/api/assets/${id}/thumbnail?size=thumbnail`,
  preview: (id) => `/api/assets/${id}/thumbnail?size=preview`,
  original: (id) => `/api/assets/${id}/original`,
  video: (id) => `/api/assets/${id}/video/playback`,
};

/**
 * A photo or video's bytes, streamed straight through (Range and If-None-Match
 * passed on). Only waiting for Immich to start answering is time-limited;
 * a long video keeps streaming. Resolves with Immich's own Response (any
 * status); rejects with an ImmichError if Immich can't be reached.
 */
export async function fetchMedia(
  c: ImmichConn, assetId: string, size: MediaSize, pass: { range?: string; ifNoneMatch?: string } = {},
): Promise<Response> {
  return fetchRaw(c, MEDIA_PATH[size](assetId), `media.${size}`, pass);
}

/** A person's face thumbnail (a JPEG), streamed like fetchMedia. */
export async function fetchPersonThumbnail(c: ImmichConn, personId: string, pass: { ifNoneMatch?: string } = {}): Promise<Response> {
  return fetchRaw(c, `/api/people/${personId}/thumbnail`, "person.thumbnail", pass);
}

async function fetchRaw(c: ImmichConn, path: string, op: string, pass: { range?: string; ifNoneMatch?: string }): Promise<Response> {
  const headers: Record<string, string> = { "x-api-key": c.key ?? "" };
  if (pass.range) headers.Range = pass.range;
  if (pass.ifNoneMatch) headers["If-None-Match"] = pass.ifNoneMatch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${c.url}${path}`, { headers, signal: ctrl.signal });
  } catch (e) {
    throw explain(op, c.url, e);
  } finally {
    clearTimeout(timer);
  }
}
