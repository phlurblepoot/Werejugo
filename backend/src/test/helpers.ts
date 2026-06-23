import type { FastifyInstance } from "fastify";
import { pool, query } from "../db/pool.js";
import { buildApp } from "../index.js";

export interface TestCtx {
  app: FastifyInstance;
  token: string;
  familyId: string;
  userId: string;
}

const APP_TABLES = [
  "links", "comments", "visit_waypoints", "map_set_visits",
  "media", "documents", "visits", "trips", "people",
  "icons", "themes", "map_sets", "share_links", "users", "families",
];

/** Truncate all app tables (keeps reference data: airports/ports). */
export async function resetDb(): Promise<void> {
  await query(`TRUNCATE ${APP_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

/** Build the app, reset the DB, and create one family + owner user with a signed token. */
export async function buildTestApp(): Promise<TestCtx> {
  const app = await buildApp();
  await resetDb();
  const fam = await query<{ id: string }>(
    "INSERT INTO families (name, invite_code) VALUES ('Test Family', 'invite-123') RETURNING id",
  );
  const familyId = fam.rows[0].id;
  const user = await query<{ id: string }>(
    `INSERT INTO users (family_id, email, display_name, password_hash, role)
     VALUES ($1, 'owner@test.dev', 'Owner', 'x', 'owner') RETURNING id`,
    [familyId],
  );
  const userId = user.rows[0].id;
  const token = app.jwt.sign({ id: userId, familyId, role: "owner" });
  return { app, token, familyId, userId };
}

export async function closeTestApp(ctx: TestCtx): Promise<void> {
  await ctx.app.close();
  await pool.end();
}
