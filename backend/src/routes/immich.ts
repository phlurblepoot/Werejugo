import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { requireAdmin, requireAuth, requireOwner } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/errors.js";
import { secretBox, SecretUnreadable } from "../lib/secretbox.js";
import {
  adminConn, checkFamily, checkServer, familyState, isConfigured, linkFamily, provisionFamily, saveServer,
  setFamilyPassword, unlinkFamily, verifyServer, type ServerCheck,
} from "../lib/immich/provision.js";
import { SUPPORTED_RANGE } from "../lib/immich/version.js";

const id = (params: unknown) => (params as { id: string }).id;

/** Everything the Admin → Immich page shows. Keys never leave the server. */
async function overview() {
  const box = secretBox();
  const server = (await query<{ url: string; last_check: ServerCheck | null; updated_at: string }>(
    "SELECT url, last_check, updated_at FROM immich_server")).rows[0];
  const families = (await query<{
    id: string; name: string; mode: "created" | "linked" | null; immich_email: string | null;
    api_key_sealed: string | null; last_error: string | null; last_ok_at: string | null;
  }>(
    `SELECT f.id, f.name, fi.mode, fi.immich_email, fi.api_key_sealed, fi.last_error, fi.last_ok_at
       FROM families f LEFT JOIN family_immich fi ON fi.family_id = f.id
      ORDER BY f.created_at`)).rows;
  return {
    encryptionReady: box.ready,
    encryptionProblem: box.problem,
    configured: Boolean(server),
    url: server?.url ?? null,
    adminKeySet: Boolean(server),
    updatedAt: server?.updated_at ?? null,
    check: server?.last_check ?? null,
    supportedRange: SUPPORTED_RANGE,
    families: families.map((f) => ({
      id: f.id,
      name: f.name,
      state: familyState(f.mode ? { mode: f.mode, api_key_sealed: f.api_key_sealed, last_error: f.last_error } : null),
      mode: f.mode,
      immichEmail: f.immich_email,
      lastError: f.last_error,
      lastOkAt: f.last_ok_at,
    })),
  };
}

function needEncryption(): void {
  const box = secretBox();
  if (!box.ready) throw new HttpError(409, box.problem!);
}

/** Server admin: connect Werejugo to Immich and give families their accounts. */
export async function adminImmichRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireAdmin);

  app.get("/api/admin/immich", async () => overview());

  app.put("/api/admin/immich", async (req) => {
    const b = z.object({ url: z.string().trim().min(1).max(500), adminKey: z.string().trim().min(1).max(500).optional() }).parse(req.body);
    needEncryption();
    let adminKey = b.adminKey;
    if (!adminKey) {
      if (!(await isConfigured())) throw new HttpError(400, "Enter the Immich admin API key");
      try {
        adminKey = (await adminConn()).key!;
      } catch (e) {
        if (e instanceof HttpError || e instanceof SecretUnreadable) throw new HttpError(400, "Enter the Immich admin API key again");
        throw e;
      }
    }
    const verified = await verifyServer(b.url, adminKey);
    await saveServer(verified.url, adminKey, req.user.id);
    await audit({
      actorId: req.user.id, action: "immich.configured", target: verified.url,
      details: { version: verified.version, supported: verified.supported, keyChanged: Boolean(b.adminKey) },
    });
    await checkServer();
    return overview();
  });

  // Re-check the server and every family's key.
  app.post("/api/admin/immich/check", async () => {
    if (await isConfigured()) {
      await checkServer();
      const rows = (await query<{ family_id: string }>("SELECT family_id FROM family_immich")).rows;
      for (const r of rows) await checkFamily(r.family_id);
    }
    return overview();
  });

  // Give a family its own Immich account (also "retry" and "re-key").
  app.post("/api/admin/immich/families/:id/connect", async (req) => {
    needEncryption();
    const state = await provisionFamily(id(req.params));
    await audit({ actorId: req.user.id, action: "immich.family_connected", familyId: id(req.params), details: { state } });
    return overview();
  });

  // Use an Immich account that already exists (by one of its API keys).
  app.post("/api/admin/immich/families/:id/link", async (req) => {
    const b = z.object({ apiKey: z.string().trim().min(1).max(500) }).parse(req.body);
    needEncryption();
    const fam = (await query("SELECT 1 FROM families WHERE id = $1", [id(req.params)])).rowCount;
    if (!fam) throw new HttpError(404, "Family not found");
    await linkFamily(id(req.params), b.apiKey);
    await audit({ actorId: req.user.id, action: "immich.family_linked", familyId: id(req.params) });
    return overview();
  });

  // Stop using the family's Immich account (the account and its photos stay in Immich).
  app.delete("/api/admin/immich/families/:id", async (req) => {
    if (!(await unlinkFamily(id(req.params)))) throw new HttpError(404, "That family isn't connected to Immich");
    await audit({ actorId: req.user.id, action: "immich.family_disconnected", familyId: id(req.params) });
    return overview();
  });

  // Every family without a working connection gets one.
  app.post("/api/admin/immich/connect-all", async (req) => {
    needEncryption();
    await adminConn();
    const todo = (await query<{ id: string; name: string }>(
      `SELECT f.id, f.name FROM families f LEFT JOIN family_immich fi ON fi.family_id = f.id
        WHERE fi.family_id IS NULL OR fi.api_key_sealed IS NULL OR fi.last_error IS NOT NULL
        ORDER BY f.created_at`)).rows;
    const results: Array<{ id: string; name: string; ok: boolean; error?: string }> = [];
    for (const f of todo) {
      try {
        await provisionFamily(f.id);
        results.push({ id: f.id, name: f.name, ok: true });
      } catch (e) {
        results.push({ id: f.id, name: f.name, ok: false, error: e instanceof Error ? e.message : "failed" });
      }
    }
    await audit({ actorId: req.user.id, action: "immich.connect_all", details: { connected: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length } });
    return { ...(await overview()), results };
  });
}

/** Any signed-in family: is Immich on for us? Owners also see the login for using Immich directly. */
export async function familyImmichRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/immich", async (req) => {
    const row = (await query<{ mode: "created" | "linked"; immich_email: string; immich_user_id: string | null; api_key_sealed: string | null; last_error: string | null }>(
      "SELECT mode, immich_email, immich_user_id, api_key_sealed, last_error FROM family_immich WHERE family_id = $1",
      [req.user.familyId])).rows[0];
    const server = (await query<{ url: string }>("SELECT url FROM immich_server")).rows[0];
    const state = server ? familyState(row ?? null) : "none";
    const base = { enabled: state === "created" || state === "linked", state };
    if (req.user.role !== "owner" || !row || !server) return base;
    return {
      ...base,
      url: server.url,
      email: row.immich_email,
      mode: row.mode,
      canSetPassword: row.mode === "created" && Boolean(row.immich_user_id),
    };
  });

  app.post("/api/immich/password", { preHandler: requireOwner }, async (req) => {
    const b = z.object({ password: z.string().min(8, "Use at least 8 characters").max(200) }).parse(req.body);
    await setFamilyPassword(req.user.familyId, b.password);
    await audit({ actorId: req.user.id, action: "immich.password_set", familyId: req.user.familyId });
    return { ok: true };
  });
}
