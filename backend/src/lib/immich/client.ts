import * as sdk from "@immich/sdk";
import type { ImmichVersion } from "./version.js";

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

function explain(op: string, url: string, e: unknown): ImmichError {
  if (e instanceof ImmichError) return e;
  if (sdk.isHttpError(e)) {
    const status = e.status;
    // Immich sends a string, or a list of strings for validation errors.
    const raw: unknown = e.data?.message;
    const detail = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("; ") : "";
    if (status === 401) return new ImmichError("unauthorized", "Immich rejected the API key (it may have been deleted or mistyped)", status, op);
    if (status === 403) {
      return new ImmichError("forbidden", detail.startsWith("Missing required permission")
        ? `The Immich API key is missing a permission (${detail.replace("Missing required permission: ", "")}). Create a key with all permissions.`
        : "The Immich API key isn't allowed to do this (it must belong to an Immich admin)", status, op);
    }
    return new ImmichError(status >= 500 ? "unexpected" : "rejected", detail || `Immich answered ${status}`, status, op);
  }
  if (sdk.isMalformedResponseError(e)) {
    return new ImmichError("unexpected", `${url} answered, but not like Immich does. Check the address.`, e.status, op);
  }
  const name = (e as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return new ImmichError("unreachable", `Immich at ${url} didn't answer within ${TIMEOUT_MS / 1000} seconds`, null, op);
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
};
