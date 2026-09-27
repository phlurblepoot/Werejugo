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
    "INSERT INTO media (family_id, kind, immich_asset_id, caption) VALUES ($1,'image',gen_random_uuid(),'Nice') RETURNING id",
    [ctx.familyId]);
  await query(
    `INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role)
     VALUES ($1,'media',$2,'visit',$3,'appears_in')`, [ctx.familyId, m.rows[0].id, v.rows[0].id]);

  const res = await ctx.app.inject({ method: "GET", url: `/api/visits/${v.rows[0].id}`, headers: auth() });
  const dto = res.json();
  expect(dto.photos).toHaveLength(1);
  expect(dto.photos[0]).toMatchObject({ mediaType: "image", caption: "Nice" });
  expect(dto.photos[0].url).toMatch(/^\/api\/m\/[0-9a-f-]{36}\/preview\?e=\d+&s=[\w-]+$/);
  expect(dto.photos[0].thumbUrl).toMatch(/^\/api\/m\/[0-9a-f-]{36}\/thumbnail\?e=\d+&s=[\w-]+$/);
});

test("the map list carries photos, waypoints and tagged people for every place in one go", async () => {
  const v = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title) VALUES ($1,'food','Joe''s') RETURNING id", [ctx.familyId]);
  await query("INSERT INTO visit_waypoints (visit_id, label, geom) VALUES ($1, 'Door', ST_SetSRID(ST_MakePoint(1, 2), 4326))", [v.rows[0].id]);
  const person = (await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1, 'Kid') RETURNING id", [ctx.familyId])).rows[0].id;
  await query("INSERT INTO links (family_id, from_type, from_id, to_type, to_id) VALUES ($1, 'person', $2, 'visit', $3)", [ctx.familyId, person, v.rows[0].id]);

  const arr = (await ctx.app.inject({ method: "GET", url: "/api/visits", headers: auth() })).json();
  const joes = arr.find((x: { title: string }) => x.title === "Joe's");
  expect(joes).toMatchObject({ kind: "food", canEdit: true, personIds: [person] });
  expect(joes.waypoints).toEqual([expect.objectContaining({ label: "Door", lng: 1, lat: 2 })]);
  expect(arr.find((x: { photos: unknown[] }) => x.photos.length === 1)).toBeTruthy();
});
