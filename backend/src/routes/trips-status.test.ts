import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("a trip defaults to 'idea' and can be moved to another status", async () => {
  const create = await ctx.app.inject({ method: "POST", url: "/api/trips", headers: auth(), payload: { name: "Japan someday" } });
  expect(create.json().status).toBe("idea");
  const id = create.json().id;
  const patch = await ctx.app.inject({ method: "PATCH", url: `/api/trips/${id}`, headers: auth(), payload: { status: "planning" } });
  expect(patch.json().status).toBe("planning");
});

test("rejects an invalid status", async () => {
  const res = await ctx.app.inject({ method: "POST", url: "/api/trips", headers: auth(), payload: { name: "X", status: "nope" } });
  expect(res.statusCode).toBe(400);
});
