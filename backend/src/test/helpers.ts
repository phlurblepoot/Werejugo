import { mkdir, rm } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { pool, query } from "../db/pool.js";
import { buildApp } from "../index.js";
import { hashPassword } from "../lib/auth.js";

export interface TestCtx {
  app: FastifyInstance;
  token: string;
  familyId: string;
  userId: string;
}

const APP_TABLES = [
  "links", "comments", "visit_waypoints",
  "media", "documents", "visits", "trips", "people", "packing_lists",
  "icons", "themes", "share_links", "invites", "password_resets", "audit_log",
  "trip_members", "trip_invites", "person_links", "activity",
  "users", "families",
];

/** Truncate all app tables (keeps reference data: airports/ports) and wipe the
 *  storage tree so file paths are reproducible across runs. */
export async function resetDb(): Promise<void> {
  await query(`TRUNCATE ${APP_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await rm(config.storageDir, { recursive: true, force: true });
  await mkdir(config.storageDir, { recursive: true });
}

/** Build the app, reset the DB, and create one family whose owner is also the
 *  server admin (as the setup wizard would), with a signed token. */
export async function buildTestApp(): Promise<TestCtx> {
  const app = await buildApp();
  await resetDb();
  const fam = await query<{ id: string }>("INSERT INTO families (name) VALUES ('Test Family') RETURNING id");
  const familyId = fam.rows[0].id;
  const user = await query<{ id: string }>(
    `INSERT INTO users (family_id, email, display_name, password_hash, role, is_admin)
     VALUES ($1, 'owner@test.dev', 'Owner', 'x', 'owner', true) RETURNING id`,
    [familyId],
  );
  const userId = user.rows[0].id;
  const token = app.jwt.sign({ id: userId, familyId, role: "owner", tv: 0 });
  return { app, token, familyId, userId };
}

export interface TestUser {
  userId: string;
  familyId: string;
  token: string;
}

let seq = 0;

/** Add a user (in an existing family, or a new one) and sign a token for them. */
export async function addUser(
  ctx: TestCtx,
  opts: { familyId?: string; familyName?: string; role?: "owner" | "member"; isAdmin?: boolean; email?: string; password?: string } = {},
): Promise<TestUser> {
  const familyId = opts.familyId ?? (await query<{ id: string }>(
    "INSERT INTO families (name) VALUES ($1) RETURNING id", [opts.familyName ?? `Family ${++seq}`])).rows[0].id;
  const role = opts.role ?? "member";
  const hash = opts.password ? await hashPassword(opts.password) : "x";
  const userId = (await query<{ id: string }>(
    `INSERT INTO users (family_id, email, display_name, password_hash, role, is_admin)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [familyId, opts.email ?? `user${++seq}@test.dev`, `User ${seq}`, hash, role, opts.isAdmin ?? false])).rows[0].id;
  return { userId, familyId, token: ctx.app.jwt.sign({ id: userId, familyId, role, tv: 0 }) };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function closeTestApp(ctx: TestCtx): Promise<void> {
  await ctx.app.close();
  await pool.end();
}
