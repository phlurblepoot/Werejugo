import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let visitId: string;
let mediaId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  const v = await query<{ id: string }>(
    "INSERT INTO visits (family_id, kind, title) VALUES ($1,'place','Eiffel Tower') RETURNING id",
    [ctx.familyId],
  );
  visitId = v.rows[0].id;
  const m = await query<{ id: string }>(
    "INSERT INTO media (family_id, kind, rel_path) VALUES ($1,'image','loose/2024/a.jpg') RETURNING id",
    [ctx.familyId],
  );
  mediaId = m.rows[0].id;
});
afterAll(async () => { await closeTestApp(ctx); });

const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates and lists a media↔visit link", async () => {
  const create = await ctx.app.inject({
    method: "POST", url: "/api/links", headers: auth(),
    payload: { from: `media:${mediaId}`, to: `visit:${visitId}`, role: "appears_in" },
  });
  expect(create.statusCode).toBe(201);

  const list = await ctx.app.inject({
    method: "GET", url: `/api/links?entity=visit:${visitId}`, headers: auth(),
  });
  expect(list.statusCode).toBe(200);
  expect(list.json()).toHaveLength(1);
});

test("rejects a disallowed pair", async () => {
  const res = await ctx.app.inject({
    method: "POST", url: "/api/links", headers: auth(),
    payload: { from: `media:${mediaId}`, to: `trip:${visitId}` },
  });
  expect(res.statusCode).toBe(400);
});
