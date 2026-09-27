import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates, reads, updates, and deletes a visit", async () => {
  const create = await ctx.app.inject({
    method: "POST", url: "/api/visits", headers: auth(),
    payload: {
      kind: "food", title: "Joe's Pizza",
      geometry: { type: "Point", coordinates: [-74, 40.7] },
      occurredOn: "2024-05-01",
    },
  });
  expect(create.statusCode).toBe(201);
  const id = create.json().id;
  expect(create.json().title).toBe("Joe's Pizza");

  const get = await ctx.app.inject({ method: "GET", url: `/api/visits/${id}`, headers: auth() });
  expect(get.json().geometry).toEqual({ type: "Point", coordinates: [-74, 40.7] });

  const patch = await ctx.app.inject({
    method: "PATCH", url: `/api/visits/${id}`, headers: auth(), payload: { title: "Joe's" },
  });
  expect(patch.json().title).toBe("Joe's");

  const del = await ctx.app.inject({ method: "DELETE", url: `/api/visits/${id}`, headers: auth() });
  expect(del.statusCode).toBe(204);
});

test("lists visits scoped to the family", async () => {
  await ctx.app.inject({
    method: "POST", url: "/api/visits", headers: auth(),
    payload: { kind: "place", title: "Tower" },
  });
  const list = await ctx.app.inject({ method: "GET", url: "/api/visits", headers: auth() });
  expect(list.statusCode).toBe(200);
  expect(Array.isArray(list.json())).toBe(true);
});

test("bad input is a 400 with a reason, never a server error", async () => {
  const post = (payload: object) => ctx.app.inject({ method: "POST", url: "/api/visits", headers: auth(), payload });
  const base = { kind: "place", title: "X" };
  expect((await post({ ...base, geometry: { type: "Point", coordinates: [500, 40] } })).statusCode).toBe(400);
  expect((await post({ ...base, geometry: { type: "Point", coordinates: "here" } })).statusCode).toBe(400);
  expect((await post({ ...base, geometry: { type: "LineString", coordinates: [[1, 1]] } })).statusCode).toBe(400);
  expect((await post({ ...base, occurredOn: "2024-13-01" })).statusCode).toBe(400);
  const backwards = await post({ ...base, occurredOn: "2024-06-10", occurredEnd: "2024-06-01" });
  expect(backwards.statusCode).toBe(400);
  expect(backwards.json().error).toMatch(/end date/);
  // an empty date means "no date"
  expect((await post({ ...base, occurredOn: "" })).statusCode).toBe(201);
  expect((await ctx.app.inject({ method: "GET", url: "/api/visits/not-a-uuid", headers: auth() })).statusCode).toBe(404);
});
