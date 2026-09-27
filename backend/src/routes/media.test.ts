import FormData from "form-data";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { query } from "../db/pool.js";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { startFakeImmich, type FakeImmich } from "../test/fake-immich.js";
import { connectToFake, jpeg } from "../test/photos.js";
import { forgetFamilyConn } from "../lib/immich/provision.js";

let ctx: TestCtx;
let fake: FakeImmich;
let immichUserId = "";
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
beforeEach(async () => {
  fake = await startFakeImmich();
  ({ immichUserId } = await connectToFake(fake, ctx.userId, ctx.familyId));
});
afterEach(async () => {
  await fake.close();
  forgetFamilyConn();
  await query("DELETE FROM media");
  await query("DELETE FROM family_immich");
  await query("DELETE FROM immich_server");
});

function upload(buf: Buffer, opts: { name?: string; type?: string; caption?: string; token?: string } = {}) {
  const form = new FormData();
  form.append("file", buf, { filename: opts.name ?? "photo.jpg", contentType: opts.type ?? "image/jpeg" });
  if (opts.caption) form.append("caption", opts.caption);
  return ctx.app.inject({ method: "POST", url: "/api/media", headers: { ...bearer(opts.token ?? ctx.token), ...form.getHeaders() }, payload: form.getBuffer() });
}

test("an upload goes to the family's Immich account and comes back with Werejugo links", async () => {
  const res = await upload(await jpeg({ date: "2024-06-10T10:00:00", lat: 41.8903, lng: 12.4922 }), { caption: "Colosseum" });
  expect(res.statusCode, res.body).toBe(201);
  const m = res.json();
  expect(m).toMatchObject({ kind: "image", caption: "Colosseum", originalName: "photo.jpg", duplicate: false });
  // Date and place from the photo right away (Immich fills in its own later).
  expect(m.takenAt).toBe("2024-06-10T10:00:00.000Z");
  expect(m.lat).toBeCloseTo(41.8903, 3);
  expect(m.lng).toBeCloseTo(12.4922, 3);
  for (const k of ["thumbUrl", "url", "originalUrl"]) expect(m[k]).toMatch(new RegExp(`^/api/m/${m.id}/`));
  expect(m.videoUrl).toBeNull();

  const row = (await query("SELECT immich_asset_id, created_by FROM media WHERE id = $1", [m.id])).rows[0];
  const asset = fake.assets.get(row.immich_asset_id)!;
  expect(asset.ownerId).toBe(immichUserId); // the family's own account, not the admin's
  expect(asset.description).toBe("Colosseum");
  expect(row.created_by).toBe(ctx.userId);
});

test("the same file again is 'already in your library', not a second copy", async () => {
  const buf = await jpeg();
  const first = (await upload(buf)).json();
  const again = await upload(buf, { name: "copy.jpg" });
  expect(again.statusCode).toBe(200);
  expect(again.json()).toMatchObject({ id: first.id, duplicate: true });
  expect((await query("SELECT count(*)::int AS n FROM media")).rows[0].n).toBe(1);
  expect(fake.assets.size).toBe(1);
});

test("videos get a playback link", async () => {
  const res = await upload(Buffer.from("fake-mp4-bytes"), { name: "clip.mp4", type: "video/mp4" });
  expect(res.statusCode, res.body).toBe(201);
  expect(res.json()).toMatchObject({ kind: "video", durationMs: 12345 });
  expect(res.json().videoUrl).toMatch(/\/video\?/);
});

test("not a photo or video: refused", async () => {
  const res = await upload(Buffer.from("hello"), { name: "notes.txt", type: "text/plain" });
  expect(res.statusCode).toBe(400);
  expect(fake.assets.size).toBe(0);
});

test("a family without Immich is told to ask the admin", async () => {
  const other = await addUser(ctx, { familyName: "Unconnected", role: "owner" });
  const res = await upload(await jpeg(), { token: other.token });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toMatch(/Photos need Immich/);
});

test("Immich being down is a clear error, and nothing is half-saved", async () => {
  fake.failNext("uploadAsset", 500);
  const res = await upload(await jpeg());
  expect(res.statusCode).toBe(502);
  expect((await query("SELECT count(*)::int AS n FROM media")).rows[0].n).toBe(0);
});

test("the caption is the photo's description in Immich; a trip is just set", async () => {
  const m = (await upload(await jpeg())).json();
  const trip = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1, 'Rome') RETURNING id", [ctx.familyId])).rows[0].id;
  const res = await ctx.app.inject({ method: "PATCH", url: `/api/media/${m.id}`, headers: bearer(ctx.token), payload: { caption: "At the forum", tripId: trip } });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json()).toMatchObject({ caption: "At the forum", tripId: trip });
  const asset = [...fake.assets.values()][0];
  expect(asset.description).toBe("At the forum");
});

test("deleting moves the photo to Immich's trash and removes it from Werejugo", async () => {
  const m = (await upload(await jpeg())).json();
  const res = await ctx.app.inject({ method: "DELETE", url: `/api/media/${m.id}`, headers: bearer(ctx.token) });
  expect(res.statusCode).toBe(204);
  expect((await query("SELECT 1 FROM media WHERE id = $1", [m.id])).rowCount).toBe(0);
  const asset = [...fake.assets.values()][0];
  expect(asset.trashedAt).not.toBeNull(); // restorable in Immich
});

test("if Immich can't be reached, deleting keeps the photo", async () => {
  const m = (await upload(await jpeg())).json();
  fake.failNext("trashAssets", 500);
  const res = await ctx.app.inject({ method: "DELETE", url: `/api/media/${m.id}`, headers: bearer(ctx.token) });
  expect(res.statusCode).toBe(502);
  expect((await query("SELECT 1 FROM media WHERE id = $1", [m.id])).rowCount).toBe(1);
});
