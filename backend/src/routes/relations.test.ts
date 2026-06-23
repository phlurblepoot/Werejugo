import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("resolves a person's links to entity summaries", async () => {
  const person = await query<{ id: string }>(
    "INSERT INTO people (family_id, display_name) VALUES ($1,'Mom') RETURNING id", [ctx.familyId]);
  const visit = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title, occurred_on) VALUES ($1,'place','Eiffel Tower','2024-06-02') RETURNING id", [ctx.familyId]);
  const media = await query<{ id: string }>(
    "INSERT INTO media (family_id, kind, rel_path, thumb_rel_path, caption) VALUES ($1,'image','loose/2024/a.jpg','loose/2024/a.thumb.jpg','Selfie') RETURNING id", [ctx.familyId]);
  await query(`INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role)
               VALUES ($1,'person',$2,'visit',$3,'visited'), ($1,'media',$4,'person',$2,'shows')`,
    [ctx.familyId, person.rows[0].id, visit.rows[0].id, media.rows[0].id]);

  const res = await ctx.app.inject({
    method: "GET", url: `/api/relations?entity=person:${person.rows[0].id}`, headers: auth() });
  expect(res.statusCode).toBe(200);
  const rels = res.json();
  expect(rels).toHaveLength(2);
  const byType = Object.fromEntries(rels.map((r: any) => [r.entity.type, r.entity]));
  expect(byType.visit).toMatchObject({ label: "Eiffel Tower" });
  expect(byType.media.thumbUrl).toContain("/api/files/");
});

test("rejects a malformed entity ref", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/relations?entity=bad", headers: auth() });
  expect(res.statusCode).toBe(400);
});

test("404 for an entity in another family", async () => {
  const res = await ctx.app.inject({
    method: "GET", url: "/api/relations?entity=person:11111111-1111-1111-1111-111111111111", headers: auth() });
  expect(res.statusCode).toBe(404);
});
