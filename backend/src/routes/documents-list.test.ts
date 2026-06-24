import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await buildTestApp();
  // overdue, upcoming (within 90d lead), far-future ok, and one without expiry.
  await query("INSERT INTO documents (family_id, title, doc_type, expires_on, reminder_lead_days) VALUES ($1,'Old Visa','visa', CURRENT_DATE - 5, 30)", [ctx.familyId]);
  await query("INSERT INTO documents (family_id, title, doc_type, expires_on, reminder_lead_days) VALUES ($1,'Passport','passport', CURRENT_DATE + 30, 90)", [ctx.familyId]);
  await query("INSERT INTO documents (family_id, title, doc_type, expires_on, reminder_lead_days) VALUES ($1,'Future','insurance', CURRENT_DATE + 800, 30)", [ctx.familyId]);
  await query("INSERT INTO documents (family_id, title, doc_type) VALUES ($1,'Booking','booking')", [ctx.familyId]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("lists all documents", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/documents", headers: auth() });
  expect(res.json()).toHaveLength(4);
});

test("filters by docType and by due", async () => {
  const byType = await ctx.app.inject({ method: "GET", url: "/api/documents?docType=passport", headers: auth() });
  expect(byType.json()).toHaveLength(1);
  const due = await ctx.app.inject({ method: "GET", url: "/api/documents?due=1", headers: auth() });
  // overdue 'Old Visa' + upcoming 'Passport' (30 ≤ 90 lead); not Future, not Booking
  expect(due.json().map((d: any) => d.title).sort()).toEqual(["Old Visa", "Passport"]);
});

test("due-count returns the overdue+upcoming total", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/documents/due-count", headers: auth() });
  expect(res.json()).toEqual({ count: 2 });
});
