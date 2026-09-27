import { randomBytes } from "node:crypto";
import { query } from "../../db/pool.js";
import { HttpError } from "../errors.js";
import { secretBox, SecretUnreadable } from "../secretbox.js";
import { ADMIN_KEY_PERMISSIONS, ImmichError, immich, normalizeImmichUrl, type ImmichConn } from "./client.js";
import { formatVersion, isSupported } from "./version.js";

/**
 * Werejugo's side of the Immich connection: the server settings (address +
 * admin key) and each family's account and key. Keys are stored sealed
 * (lib/secretbox.ts) and never leave the server. Werejugo never deletes an
 * Immich account or its photos.
 */

export interface ServerCheck {
  ok: boolean;
  version: string | null;
  supported: boolean | null;
  error: string | null;
  at: string;
}

export type FamilyState = "none" | "created" | "linked" | "error";

interface FamilyRow {
  family_id: string;
  mode: "created" | "linked";
  immich_email: string;
  immich_user_id: string | null;
  api_key_id: string | null;
  api_key_sealed: string | null;
  last_ok_at: string | null;
  last_error: string | null;
}

const conflict = (message: string) => new HttpError(409, message);
const bad = (message: string) => new HttpError(400, message);

/** An ImmichError becomes a 400 carrying its message; anything else is rethrown. */
function asHttp(e: unknown): never {
  if (e instanceof ImmichError) throw bad(e.message);
  throw e;
}

// ---- Server settings ----

export async function isConfigured(): Promise<boolean> {
  return ((await query("SELECT 1 FROM immich_server")).rowCount ?? 0) > 0;
}

/** Address + admin key, or a 409 saying what to do. */
export async function adminConn(): Promise<ImmichConn> {
  const row = (await query<{ url: string; admin_key_sealed: string }>("SELECT url, admin_key_sealed FROM immich_server")).rows[0];
  if (!row) throw conflict("Immich isn't set up yet (Admin → Immich)");
  const box = secretBox();
  if (!box.ready) throw conflict(box.problem!);
  try {
    return { url: row.url, key: box.open(row.admin_key_sealed) };
  } catch (e) {
    if (e instanceof SecretUnreadable) throw conflict("The stored Immich admin key can't be read (ENCRYPTION_KEY changed?). Enter the admin key again.");
    throw e;
  }
}

/**
 * Check an address and admin key the way Werejugo will use them: Immich
 * answers, the key belongs to an admin, and it has the permissions needed to
 * create and manage family accounts. Returns the normalized address and version.
 */
export async function verifyServer(rawUrl: string, adminKey: string): Promise<{ url: string; version: string; supported: boolean }> {
  try {
    const url = normalizeImmichUrl(rawUrl);
    await immich.ping(url);
    const v = await immich.version(url);
    const me = await immich.me({ url, key: adminKey });
    if (!me.isAdmin) throw bad(`That key belongs to ${me.email}, who isn't an Immich admin. Use a key made by the Immich admin account.`);
    const key = await immich.currentKey({ url, key: adminKey });
    const perms = new Set<string>(key.permissions);
    const missing = perms.has("all") ? [] : ADMIN_KEY_PERMISSIONS.filter((p) => !perms.has(p));
    if (missing.length) throw bad(`The Immich API key is missing permissions: ${missing.join(", ")}. Create a key with all permissions.`);
    return { url, version: formatVersion(v), supported: isSupported(v) };
  } catch (e) {
    return asHttp(e);
  }
}

export async function saveServer(url: string, adminKey: string, userId: string): Promise<void> {
  const sealed = secretBox().seal(adminKey);
  await query(
    `INSERT INTO immich_server (id, url, admin_key_sealed, updated_by, updated_at) VALUES (true, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET url = $1, admin_key_sealed = $2, updated_by = $3, updated_at = now()`,
    [url, sealed, userId]);
}

/** Ping + version + admin key; the result is stored for the admin page and the startup log. */
export async function checkServer(): Promise<ServerCheck | null> {
  if (!(await isConfigured())) return null;
  const at = new Date().toISOString();
  let result: ServerCheck;
  try {
    const conn = await adminConn();
    await immich.ping(conn.url);
    const v = await immich.version(conn.url);
    await immich.me(conn);
    result = { ok: true, version: formatVersion(v), supported: isSupported(v), error: null, at };
  } catch (e) {
    const message = e instanceof ImmichError || e instanceof HttpError ? e.message : "Immich check failed";
    result = { ok: false, version: null, supported: null, error: message, at };
  }
  await query("UPDATE immich_server SET last_check = $1", [JSON.stringify(result)]);
  return result;
}

// ---- Families ----

async function familyRow(familyId: string): Promise<FamilyRow | null> {
  return (await query<FamilyRow>("SELECT * FROM family_immich WHERE family_id = $1", [familyId])).rows[0] ?? null;
}

export function familyState(row: Pick<FamilyRow, "api_key_sealed" | "last_error" | "mode"> | null): FamilyState {
  if (!row) return "none";
  if (!row.api_key_sealed || row.last_error) return "error";
  return row.mode;
}

/** The family's own connection to Immich (its key), or null if it has none. */
export async function familyConn(familyId: string): Promise<ImmichConn | null> {
  const row = await familyRow(familyId);
  const server = (await query<{ url: string }>("SELECT url FROM immich_server")).rows[0];
  if (!row?.api_key_sealed || !server) return null;
  try {
    return { url: server.url, key: secretBox().open(row.api_key_sealed) };
  } catch {
    return null;
  }
}

function emailFor(familyName: string): string {
  const slug = familyName.normalize("NFKD").replace(/[^\w\s-]/g, "").toLowerCase().trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 30)
    .replace(/^-|-$/g, "") || "family";
  return `${slug}-${randomBytes(3).toString("hex")}@werejugo.local`;
}

async function recordError(familyId: string, message: string): Promise<void> {
  await query("UPDATE family_immich SET last_error = $2 WHERE family_id = $1", [familyId, message]);
}

/**
 * Give a family its own Immich account and key. Safe to repeat: a working
 * connection is left alone; a half-finished one (the account exists but no
 * key was stored) resumes with the same account; a key Immich no longer
 * accepts (or that can't be unsealed) is replaced ("re-key").
 */
export async function provisionFamily(familyId: string): Promise<FamilyState> {
  const admin = await adminConn();
  const fam = (await query<{ name: string }>("SELECT name FROM families WHERE id = $1", [familyId])).rows[0];
  if (!fam) throw new HttpError(404, "Family not found");
  const box = secretBox();
  let row = await familyRow(familyId);

  if (row?.api_key_sealed) {
    const conn = await familyConn(familyId);
    if (conn) {
      try {
        await immich.me(conn);
        await query("UPDATE family_immich SET last_ok_at = now(), last_error = NULL WHERE family_id = $1", [familyId]);
        return row.mode;
      } catch (e) {
        if (!(e instanceof ImmichError && e.kind === "unauthorized")) {
          await recordError(familyId, e instanceof Error ? e.message : "Immich check failed");
          throw bad(e instanceof Error ? e.message : "Immich check failed");
        }
      }
    }
    if (row.mode === "linked") {
      const message = "The linked Immich account's key no longer works. Link it again with a new key.";
      await recordError(familyId, message);
      throw conflict(message);
    }
  }

  if (!row) {
    await query("INSERT INTO family_immich (family_id, mode, immich_email) VALUES ($1, 'created', $2)", [familyId, emailFor(fam.name)]);
    row = (await familyRow(familyId))!;
  }

  try {
    const password = randomBytes(24).toString("base64url");
    const existing = (await immich.listUsers(admin)).find((u) => u.email.toLowerCase() === row!.immich_email.toLowerCase());
    const user = existing ?? (await immich.createUser(admin, { email: row.immich_email, name: fam.name, password }));
    if (existing) await immich.setPassword(admin, existing.id, password);
    await query("UPDATE family_immich SET immich_user_id = $2 WHERE family_id = $1", [familyId, user.id]);

    const session = await immich.login(admin.url, row.immich_email, password);
    const created = await immich.createApiKey({ url: admin.url, token: session.accessToken }, "Werejugo");
    // Replace an older Werejugo key if we still hold it (best effort).
    if (row.api_key_id && row.api_key_id !== created.id) {
      await immich.deleteApiKey({ url: admin.url, key: created.secret }, row.api_key_id).catch(() => {});
    }
    await query(
      `UPDATE family_immich SET api_key_id = $2, api_key_sealed = $3, last_ok_at = now(), last_error = NULL WHERE family_id = $1`,
      [familyId, created.id, box.seal(created.secret)]);
    return "created";
  } catch (e) {
    const message = e instanceof Error ? e.message : "Setting up the Immich account failed";
    await recordError(familyId, message);
    return asHttp(e);
  }
}

/** Use an Immich account that already exists, by one of its API keys. */
export async function linkFamily(familyId: string, apiKey: string): Promise<void> {
  const admin = await adminConn();
  const conn = { url: admin.url, key: apiKey.trim() };
  let me: Awaited<ReturnType<typeof immich.me>>;
  let keyId: string | null = null;
  try {
    me = await immich.me(conn);
    keyId = (await immich.currentKey(conn)).id;
  } catch (e) {
    if (e instanceof ImmichError && e.kind === "unauthorized") throw bad("Immich rejected that key");
    return asHttp(e);
  }
  if (me.isAdmin) throw bad("That key belongs to an Immich admin account. Link a family's own account instead.");
  const taken = (await query<{ name: string }>(
    "SELECT f.name FROM family_immich fi JOIN families f ON f.id = fi.family_id WHERE fi.immich_user_id = $1 AND fi.family_id <> $2",
    [me.id, familyId])).rows[0];
  if (taken) throw conflict(`That Immich account is already connected to ${taken.name}`);
  await query(
    `INSERT INTO family_immich (family_id, mode, immich_email, immich_user_id, api_key_id, api_key_sealed, last_ok_at, last_error)
     VALUES ($1, 'linked', $2, $3, $4, $5, now(), NULL)
     ON CONFLICT (family_id) DO UPDATE SET mode = 'linked', immich_email = $2, immich_user_id = $3, api_key_id = $4,
       api_key_sealed = $5, last_ok_at = now(), last_error = NULL`,
    [familyId, me.email, me.id, keyId, secretBox().seal(conn.key)]);
}

/** Stop using the family's Immich account. Its key is revoked when possible; the account and photos stay in Immich. */
export async function unlinkFamily(familyId: string): Promise<boolean> {
  const row = await familyRow(familyId);
  if (!row) return false;
  const conn = await familyConn(familyId);
  if (conn && row.api_key_id) await immich.deleteApiKey(conn, row.api_key_id).catch(() => {});
  await query("DELETE FROM family_immich WHERE family_id = $1", [familyId]);
  return true;
}

/** Is the family's key still accepted? Records the result. */
export async function checkFamily(familyId: string): Promise<FamilyState> {
  const row = await familyRow(familyId);
  if (!row) return "none";
  if (!row.api_key_sealed) return "error";
  const conn = await familyConn(familyId);
  if (!conn) {
    await recordError(familyId, "The stored key can't be read (ENCRYPTION_KEY changed?). Use Retry to give the family a new key.");
    return "error";
  }
  try {
    await immich.me(conn);
    await query("UPDATE family_immich SET last_ok_at = now(), last_error = NULL WHERE family_id = $1", [familyId]);
    return row.mode;
  } catch (e) {
    const message = e instanceof ImmichError && e.kind === "unauthorized"
      ? (row.mode === "created" ? "Immich no longer accepts the family's key. Use Retry to give it a new one." : "Immich no longer accepts the linked account's key. Link it again.")
      : e instanceof Error ? e.message : "Immich check failed";
    await recordError(familyId, message);
    return "error";
  }
}

/** Set the password of a Werejugo-created account, so the family can sign in to Immich itself. */
export async function setFamilyPassword(familyId: string, password: string): Promise<void> {
  const row = await familyRow(familyId);
  if (!row || row.mode !== "created" || !row.immich_user_id) {
    throw conflict("Only an Immich account Werejugo created can have its password set here");
  }
  const admin = await adminConn();
  try {
    await immich.setPassword(admin, row.immich_user_id, password);
  } catch (e) {
    return asHttp(e);
  }
}

// ---- New families ----

const pending = new Set<Promise<unknown>>();

/**
 * A family was just created: give it an Immich account in the background if
 * Immich is set up. Failures are recorded on the family (admin page → Retry)
 * and never fail the request that created the family.
 */
export function provisionNewFamily(familyId: string, log?: { warn: (o: object, msg: string) => void }): void {
  const p = (async () => {
    if (!(await isConfigured()) || !secretBox().ready) return;
    await provisionFamily(familyId);
  })().catch((e) => log?.warn({ err: e instanceof Error ? e.message : e, familyId }, "Couldn't set up the family's Immich account"))
    .finally(() => pending.delete(p));
  pending.add(p);
}

/** Tests: wait for background provisioning to finish. */
export async function settleProvisioning(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}
