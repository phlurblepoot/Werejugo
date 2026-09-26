import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("creates a fileless document (JSON) and reads it back with status", async () => {
  const person = await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1,'Dad') RETURNING id", [ctx.familyId]);
  const create = await ctx.app.inject({
    method: "POST", url: "/api/documents", headers: auth(),
    payload: { title: "Dad's Passport", docType: "passport", ownerPersonId: person.rows[0].id, expiresOn: "2031-04-11", reminderLeadDays: 90 },
  });
  expect(create.statusCode).toBe(201);
  const dto = create.json();
  expect(dto).toMatchObject({ title: "Dad's Passport", docType: "passport", ownerPersonName: "Dad", fileUrl: null, status: "ok" });

  const get = await ctx.app.inject({ method: "GET", url: `/api/documents/${dto.id}`, headers: auth() });
  expect(get.json().reminderLeadDays).toBe(90);
});

test("rejects an owner that isn't the family's", async () => {
  const res = await ctx.app.inject({
    method: "POST", url: "/api/documents", headers: auth(),
    payload: { title: "X", docType: "other", ownerPersonId: "11111111-1111-1111-1111-111111111111" },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe("Unknown person");
});

test("a document never ends up with two owners", async () => {
  const person = (await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1, 'Mum') RETURNING id", [ctx.familyId])).rows[0].id;
  const trip = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1, 'Oslo') RETURNING id", [ctx.familyId])).rows[0].id;
  const both = await ctx.app.inject({ method: "POST", url: "/api/documents", headers: auth(), payload: { title: "B", docType: "other", ownerPersonId: person, ownerTripId: trip } });
  expect(both.statusCode).toBe(400);

  const doc = (await ctx.app.inject({ method: "POST", url: "/api/documents", headers: auth(), payload: { title: "Visa", docType: "visa", ownerPersonId: person } })).json();
  // sending only the trip moves the document to the trip (it doesn't keep the person too)
  const moved = (await ctx.app.inject({ method: "PATCH", url: `/api/documents/${doc.id}`, headers: auth(), payload: { ownerTripId: trip } })).json();
  expect(moved).toMatchObject({ ownerTripId: trip, ownerPersonId: null });
  // a bad date is a 400, not a server error
  const bad = await ctx.app.inject({ method: "PATCH", url: `/api/documents/${doc.id}`, headers: auth(), payload: { expiresOn: "2024-02-30" } });
  expect(bad.statusCode).toBe(400);
});
