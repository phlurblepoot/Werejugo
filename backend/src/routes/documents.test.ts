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
  expect(res.statusCode).toBe(404);
});
