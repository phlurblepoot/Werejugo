import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates, lists, updates, and deletes a blackout", async () => {
  const create = await ctx.app.inject({ method: "POST", url: "/api/blackouts", headers: auth(),
    payload: { label: "School 2025-26", startDate: "2025-09-01", endDate: "2026-06-15" } });
  expect(create.statusCode).toBe(201);
  const id = create.json().id;
  const list = await ctx.app.inject({ method: "GET", url: "/api/blackouts", headers: auth() });
  expect(list.json()).toHaveLength(1);
  const patch = await ctx.app.inject({ method: "PATCH", url: `/api/blackouts/${id}`, headers: auth(), payload: { label: "School year" } });
  expect(patch.json().label).toBe("School year");
  const del = await ctx.app.inject({ method: "DELETE", url: `/api/blackouts/${id}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});

test("rejects an end before the start", async () => {
  const res = await ctx.app.inject({ method: "POST", url: "/api/blackouts", headers: auth(),
    payload: { label: "Bad", startDate: "2025-06-10", endDate: "2025-06-01" } });
  expect(res.statusCode).toBe(400);
});
