import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("a visit DTO includes linked media as photos with signed urls", async () => {
  const v = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title) VALUES ($1,'place','Tower') RETURNING id", [ctx.familyId]);
  const m = await query<{ id: string }>(
    "INSERT INTO media (family_id, kind, rel_path, thumb_rel_path, caption) VALUES ($1,'image','loose/2024/a.jpg','loose/2024/a.thumb.jpg','Nice') RETURNING id",
    [ctx.familyId]);
  await query(
    `INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role)
     VALUES ($1,'media',$2,'visit',$3,'appears_in')`, [ctx.familyId, m.rows[0].id, v.rows[0].id]);

  const res = await ctx.app.inject({ method: "GET", url: `/api/visits/${v.rows[0].id}`, headers: auth() });
  const dto = res.json();
  expect(dto.photos).toHaveLength(1);
  expect(dto.photos[0]).toMatchObject({ mediaType: "image", caption: "Nice" });
  expect(dto.photos[0].url).toContain("/api/files/");
  expect(dto.photos[0].thumbUrl).toContain("sig=");
});

test("GET /api/map-sets/:id/visits returns full visit DTOs for members", async () => {
  const ms = await query<{ id: string }>(
    "INSERT INTO map_sets (family_id, name) VALUES ($1,'Main') RETURNING id", [ctx.familyId]);
  const v = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title) VALUES ($1,'food','Joe''s') RETURNING id", [ctx.familyId]);
  await query("INSERT INTO map_set_visits (map_set_id, visit_id) VALUES ($1,$2)", [ms.rows[0].id, v.rows[0].id]);

  const res = await ctx.app.inject({
    method: "GET", url: `/api/map-sets/${ms.rows[0].id}/visits`, headers: auth() });
  const arr = res.json();
  expect(arr).toHaveLength(1);
  expect(arr[0]).toMatchObject({ title: "Joe's", kind: "food" });
  expect(Array.isArray(arr[0].photos)).toBe(true);
});
