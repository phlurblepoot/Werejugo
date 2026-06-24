import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
let tripId: string;
beforeAll(async () => {
  ctx = await buildTestApp();
  tripId = (await query<{ id: string }>(
    "INSERT INTO trips (family_id, name, created_by) VALUES ($1,'Italy',$2) RETURNING id", [ctx.familyId, ctx.userId])).rows[0].id;
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates a trip share and lists it", async () => {
  const c = await ctx.app.inject({ method: "POST", url: "/api/shares", headers: auth(),
    payload: { targetType: "trip", targetId: tripId } });
  expect(c.statusCode).toBe(201);
  expect(c.json().token).toHaveLength(20);

  const l = await ctx.app.inject({ method: "GET", url: `/api/shares?targetType=trip&targetId=${tripId}`, headers: auth() });
  expect(l.json()).toHaveLength(1);
});

test("creates an album share for a trip's gallery", async () => {
  const c = await ctx.app.inject({ method: "POST", url: "/api/shares", headers: auth(),
    payload: { targetType: "album", targetId: tripId } });
  expect(c.statusCode).toBe(201);
});

test("rejects an unknown target type", async () => {
  const c = await ctx.app.inject({ method: "POST", url: "/api/shares", headers: auth(),
    payload: { targetType: "mapset", targetId: tripId } });
  expect(c.statusCode).toBe(400);
});

test("rejects a target the family does not own", async () => {
  const fam2 = (await query<{ id: string }>(
    "INSERT INTO families (name, invite_code) VALUES ('Other','inv-x') RETURNING id")).rows[0].id;
  const foreign = (await query<{ id: string }>(
    "INSERT INTO trips (family_id, name) VALUES ($1,'Foreign') RETURNING id", [fam2])).rows[0].id;
  const c = await ctx.app.inject({ method: "POST", url: "/api/shares", headers: auth(),
    payload: { targetType: "trip", targetId: foreign } });
  expect(c.statusCode).toBe(404);
});

test("deletes a share", async () => {
  const c = await ctx.app.inject({ method: "POST", url: "/api/shares", headers: auth(),
    payload: { targetType: "trip", targetId: tripId } });
  const id = c.json().id;
  const d = await ctx.app.inject({ method: "DELETE", url: `/api/shares/${id}`, headers: auth() });
  expect(d.statusCode).toBe(204);
});

test("the old map-set share route is gone", async () => {
  const r = await ctx.app.inject({ method: "POST", url: "/api/map-sets/x/shares", headers: auth(), payload: {} });
  expect(r.statusCode).toBe(404);
});
