import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates, lists, updates, and deletes a person", async () => {
  const create = await ctx.app.inject({
    method: "POST", url: "/api/people", headers: auth(),
    payload: { displayName: "Grandma", relationship: "Family" },
  });
  expect(create.statusCode).toBe(201);
  const id = create.json().id;
  expect(create.json()).toMatchObject({ displayName: "Grandma", relationship: "Family", avatarUrl: null });

  const list = await ctx.app.inject({ method: "GET", url: "/api/people", headers: auth() });
  expect(list.json()).toHaveLength(1);

  const patch = await ctx.app.inject({
    method: "PATCH", url: `/api/people/${id}`, headers: auth(), payload: { relationship: "Grandmother" } });
  expect(patch.json().relationship).toBe("Grandmother");

  const del = await ctx.app.inject({ method: "DELETE", url: `/api/people/${id}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});

test("a person's avatar resolves to a signed url", async () => {
  const m = await query<{ id: string }>(
    "INSERT INTO media (family_id, kind, rel_path, thumb_rel_path) VALUES ($1,'image','loose/2024/a.jpg','loose/2024/a.thumb.jpg') RETURNING id",
    [ctx.familyId]);
  const create = await ctx.app.inject({
    method: "POST", url: "/api/people", headers: auth(),
    payload: { displayName: "Dad", avatarMediaId: m.rows[0].id } });
  expect(create.json().avatarUrl).toContain("/api/files/");
  expect(create.json().avatarUrl).toContain("sig=");
});

test("rejects an avatar that isn't the family's media", async () => {
  const res = await ctx.app.inject({
    method: "POST", url: "/api/people", headers: auth(),
    payload: { displayName: "X", avatarMediaId: "11111111-1111-1111-1111-111111111111" } });
  expect(res.statusCode).toBe(404);
});

test("lists family members for account linking", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/family-members", headers: auth() });
  expect(res.statusCode).toBe(200);
  expect(res.json()[0]).toMatchObject({ displayName: "Owner" });
});
