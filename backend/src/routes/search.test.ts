import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;

beforeAll(async () => {
  ctx = await buildTestApp();
  const fam = ctx.familyId;
  await query("INSERT INTO trips (family_id, name, created_by) VALUES ($1,'Venice Trip',$2)", [fam, ctx.userId]);
  await query("INSERT INTO visits (family_id, kind, title, created_by) VALUES ($1,'place','Venice Visit',$2)", [fam, ctx.userId]);
  await query("INSERT INTO people (family_id, display_name) VALUES ($1,'Venice Person')", [fam]);
  await query(
    "INSERT INTO media (family_id, kind, rel_path, original_name, caption, created_by) VALUES ($1,'image','loose/2024/venice.jpg','venice.jpg','Venice photo',$2)",
    [fam, ctx.userId]);
  await query("INSERT INTO documents (family_id, title, doc_type) VALUES ($1,'Venice Passport','passport')", [fam]);

  // A second family whose data must never leak into the first family's results.
  const fam2 = (await query<{ id: string }>(
    "INSERT INTO families (name, invite_code) VALUES ('Other','inv-other') RETURNING id")).rows[0].id;
  await query("INSERT INTO trips (family_id, name) VALUES ($1,'Venice Foreign')", [fam2]);
});
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

test("groups matches across all core types", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/search?q=Venice", headers: auth() });
  expect(res.statusCode).toBe(200);
  const b = res.json();
  expect(b.trips.map((r: any) => r.label)).toEqual(["Venice Trip"]);
  expect(b.visits.map((r: any) => r.label)).toEqual(["Venice Visit"]);
  expect(b.people.map((r: any) => r.label)).toEqual(["Venice Person"]);
  expect(b.photos.map((r: any) => r.label)).toEqual(["Venice photo"]);
  expect(b.documents.map((r: any) => r.label)).toEqual(["Venice Passport"]);
  // navigation target is computed server-side
  expect(b.trips[0].to).toBe(`/planning?trip=${b.trips[0].id}`);
});

test("never leaks another family's rows", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/search?q=Venice", headers: auth() });
  const names = res.json().trips.map((r: any) => r.label);
  expect(names).not.toContain("Venice Foreign");
});

test("empty query returns empty groups", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/search?q=", headers: auth() });
  expect(res.json()).toEqual({ people: [], trips: [], visits: [], photos: [], documents: [] });
});

test("requires auth", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/search?q=Venice" });
  expect(res.statusCode).toBe(401);
});
