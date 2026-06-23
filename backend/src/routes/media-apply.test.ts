import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { absStoragePath } from "../lib/storage.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("applies a trip (sets trip_id) and a visit (links) to media", async () => {
  const trip = await query<{ id: string }>("INSERT INTO trips (family_id, name, start_date) VALUES ($1,'Italy','2024-06-01') RETURNING id", [ctx.familyId]);
  const visit = await query<{ id: string }>("INSERT INTO visits (family_id, kind, title) VALUES ($1,'place','Colosseum') RETURNING id", [ctx.familyId]);
  const m = await query<{ id: string }>("INSERT INTO media (family_id, kind, rel_path) VALUES ($1,'image','loose/2024/a.jpg') RETURNING id", [ctx.familyId]);
  const abs = absStoragePath("loose/2024/a.jpg");
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, "x");

  const resTrip = await ctx.app.inject({ method: "POST", url: "/api/media/apply-suggestion", headers: auth(),
    payload: { mediaIds: [m.rows[0].id], tripId: trip.rows[0].id } });
  expect(resTrip.statusCode).toBe(200);
  const row = await query<{ trip_id: string }>("SELECT trip_id FROM media WHERE id = $1", [m.rows[0].id]);
  expect(row.rows[0].trip_id).toBe(trip.rows[0].id);

  const resVisit = await ctx.app.inject({ method: "POST", url: "/api/media/apply-suggestion", headers: auth(),
    payload: { mediaIds: [m.rows[0].id], visitId: visit.rows[0].id } });
  expect(resVisit.statusCode).toBe(200);
  const link = await query("SELECT 1 FROM links WHERE family_id=$1 AND from_type='media' AND from_id=$2 AND to_type='visit' AND to_id=$3", [ctx.familyId, m.rows[0].id, visit.rows[0].id]);
  expect(link.rowCount).toBe(1);
});

test("rejects media from another family", async () => {
  const res = await ctx.app.inject({ method: "POST", url: "/api/media/apply-suggestion", headers: auth(),
    payload: { mediaIds: ["11111111-1111-1111-1111-111111111111"], tripId: null } });
  expect(res.statusCode).toBe(404);
});
