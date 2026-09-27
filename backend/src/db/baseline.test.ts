import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "./pool.js";
import { LegacyDatabaseError, migrate } from "./migrate.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

const id = async (sql: string, params: unknown[]) => (await query<{ id: string }>(sql, params)).rows[0].id;
const trip = (name = "T") => id("INSERT INTO trips (family_id, name) VALUES ($1, $2) RETURNING id", [ctx.familyId, name]);

test("deleting a visit, trip or person removes the links that point at it", async () => {
  const t = await trip();
  const v = await id("INSERT INTO visits (family_id, title) VALUES ($1, 'V') RETURNING id", [ctx.familyId]);
  const p = await id("INSERT INTO people (family_id, display_name) VALUES ($1, 'P') RETURNING id", [ctx.familyId]);
  const link = (ft: string, f: string, tt: string, to: string) =>
    query("INSERT INTO links (family_id, from_type, from_id, to_type, to_id) VALUES ($1, $2, $3, $4, $5)", [ctx.familyId, ft, f, tt, to]);
  await link("person", p, "trip", t);
  await link("visit", v, "person", p);
  const count = async () => (await query<{ n: number }>("SELECT count(*)::int AS n FROM links WHERE family_id = $1", [ctx.familyId])).rows[0].n;
  expect(await count()).toBe(2);
  await query("DELETE FROM visits WHERE id = $1", [v]);
  expect(await count()).toBe(1);
  await query("DELETE FROM trips WHERE id = $1", [t]);
  expect(await count()).toBe(0);
});

test("share links die with their trip; unknown target types are refused", async () => {
  const t = await trip();
  await query("INSERT INTO share_links (token, target_type, target_id, family_id) VALUES ('a1', 'trip', $1, $2), ('a2', 'album', $1, $2)", [t, ctx.familyId]);
  await query("DELETE FROM trips WHERE id = $1", [t]);
  expect((await query("SELECT 1 FROM share_links WHERE target_id = $1", [t])).rowCount).toBe(0);
  await expect(query("INSERT INTO share_links (token, target_type, target_id, family_id) VALUES ('a3', 'mapset', $1, $2)", [t, ctx.familyId])).rejects.toThrow();
});

test("date ranges, single document owner, one packing list per trip and family", async () => {
  await expect(query("INSERT INTO blackout_periods (family_id, label, start_date, end_date) VALUES ($1, 'x', '2024-06-10', '2024-06-01')", [ctx.familyId])).rejects.toThrow(/blackout_dates_chk/);
  await expect(query("INSERT INTO trips (family_id, name, start_date, end_date) VALUES ($1, 'x', '2024-06-10', '2024-06-01')", [ctx.familyId])).rejects.toThrow(/trips_dates_chk/);
  const t = await trip();
  const p = await id("INSERT INTO people (family_id, display_name) VALUES ($1, 'P') RETURNING id", [ctx.familyId]);
  await expect(query("INSERT INTO documents (family_id, title, owner_person_id, owner_trip_id) VALUES ($1, 'd', $2, $3)", [ctx.familyId, p, t])).rejects.toThrow(/documents_one_owner_chk/);
  await query("INSERT INTO packing_lists (family_id, trip_id, name) VALUES ($1, $2, 'one')", [ctx.familyId, t]);
  await expect(query("INSERT INTO packing_lists (family_id, trip_id, name) VALUES ($1, $2, 'two')", [ctx.familyId, t])).rejects.toThrow(/uq_packing_lists_trip_family/);
  // templates (no trip) are unlimited
  await query("INSERT INTO packing_lists (family_id, name) VALUES ($1, 'tpl1'), ($1, 'tpl2')", [ctx.familyId]);
});

test("a database built by the old migrations is refused, not half-upgraded", async () => {
  await query("INSERT INTO schema_migrations (filename) VALUES ('0001_init.sql')");
  try {
    await expect(migrate()).rejects.toBeInstanceOf(LegacyDatabaseError);
    await expect(migrate()).rejects.toThrow(/Resetting the database/);
  } finally {
    await query("DELETE FROM schema_migrations WHERE filename = '0001_init.sql'");
  }
  await expect(migrate()).resolves.toBeUndefined();
});
