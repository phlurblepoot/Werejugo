import { afterAll, beforeAll, expect, test } from "vitest";
import sharp from "sharp";
import FormData from "form-data";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
const auth = () => ({ authorization: `Bearer ${ctx.token}` });

async function uploadPng(filename = "trip pic.png"): Promise<string> {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#abc" } }).png().toBuffer();
  const form = new FormData();
  form.append("file", png, { filename, contentType: "image/png" });
  const res = await ctx.app.inject({
    method: "POST", url: "/api/media", headers: { ...auth(), ...form.getHeaders() }, payload: form,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

test("uploads media to loose/<year> by default and returns a signed url", async () => {
  const id = await uploadPng();
  const row = await query<{ rel_path: string }>("SELECT rel_path FROM media WHERE id = $1", [id]);
  expect(row.rows[0].rel_path).toMatch(/^loose\/\d{4}\/trip-pic\.png$/);
  const dto = await ctx.app.inject({ method: "GET", url: `/api/media/${id}`, headers: auth() });
  expect(dto.json().url).toContain("/api/files/");
  expect(dto.json().url).toContain("sig=");
});

test("setting a media's trip moves the file into the trip folder", async () => {
  // Distinct filename so it doesn't collide with the previous test's upload.
  const id = await uploadPng("italy pic.png");
  const t = await query<{ id: string }>(
    "INSERT INTO trips (family_id, name, start_date) VALUES ($1,'Italy','2024-06-01') RETURNING id",
    [ctx.familyId],
  );
  const res = await ctx.app.inject({
    method: "PATCH", url: `/api/media/${id}`, headers: auth(), payload: { tripId: t.rows[0].id },
  });
  expect(res.statusCode).toBe(200);
  const row = await query<{ rel_path: string }>("SELECT rel_path FROM media WHERE id = $1", [id]);
  expect(row.rows[0].rel_path).toBe("trips/2024-italy/photos/italy-pic.png");
});
