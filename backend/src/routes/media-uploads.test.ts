import { mkdir, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { forgetFamilyConn } from "../lib/immich/provision.js";
import { settleJobs } from "../lib/jobs.js";
import { cleanupUploads, handOff, partPath } from "../lib/media/uploads.js";
import { startFakeImmich, type FakeImmich } from "../test/fake-immich.js";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { connectToFake, jpeg } from "../test/photos.js";

let ctx: TestCtx;
let fake: FakeImmich;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
beforeEach(async () => {
  fake = await startFakeImmich();
  await connectToFake(fake, ctx.userId, ctx.familyId);
});
afterEach(async () => {
  await settleJobs();
  // Every test starts with no bytes waiting (the cleanup test counts strays).
  await rm(join(config.uploadsDir, "incoming"), { recursive: true, force: true });
  await fake.close();
  forgetFamilyConn();
  await query("DELETE FROM media_uploads");
  await query("DELETE FROM links");
  await query("DELETE FROM media");
  await query("DELETE FROM visits");
  await query("DELETE FROM trips");
  await query("DELETE FROM family_immich");
  await query("DELETE FROM immich_server");
});

type Json = Record<string, unknown>;

function create(body: Json, token = ctx.token) {
  return ctx.app.inject({ method: "POST", url: "/api/media/uploads", headers: bearer(token), payload: body });
}

function put(id: string, offset: number, bytes: Buffer, token = ctx.token) {
  return ctx.app.inject({
    method: "PUT", url: `/api/media/uploads/${id}?offset=${offset}`,
    headers: { ...bearer(token), "content-type": "application/octet-stream" }, payload: bytes,
  });
}

const get = (id: string, token = ctx.token) => ctx.app.inject({ method: "GET", url: `/api/media/uploads/${id}`, headers: bearer(token) });

/** Create an upload for `buf` and send it in pieces of `chunk` bytes. */
async function uploadAll(buf: Buffer, opts: Json & { chunk?: number } = {}) {
  const { chunk = 1024, ...extra } = opts;
  const c = await create({ filename: "photo.jpg", size: buf.length, mime: "image/jpeg", ...extra });
  expect(c.statusCode, c.body).toBe(201);
  const id = c.json().id as string;
  let last: Json = {};
  for (let at = 0; at < buf.length; at += chunk) {
    const r = await put(id, at, buf.subarray(at, at + chunk));
    expect(r.statusCode, r.body).toBe(200);
    last = r.json();
  }
  return { id, last };
}

test("a file sent in pieces is handed to Immich and becomes a photo", async () => {
  const buf = await jpeg({ date: "2023-05-04T11:12:13", lat: 38.7223, lng: -9.1393 });
  const c = await create({ filename: "lisbon.jpg", size: buf.length, mime: "image/jpeg", caption: "Tram 28", lastModified: Date.parse("2023-05-05T00:00:00Z") });
  expect(c.statusCode, c.body).toBe(201);
  expect(c.json()).toMatchObject({ offset: 0, state: "receiving", chunkSize: 8 * 1024 * 1024, size: buf.length });
  const id = c.json().id;

  // Odd-sized pieces: 3 bytes, then 1 KB at a time.
  expect((await put(id, 0, buf.subarray(0, 3))).json()).toEqual({ offset: 3, state: "receiving" });
  let at = 3;
  let last: Json = {};
  while (at < buf.length) {
    last = (await put(id, at, buf.subarray(at, at + 1024))).json();
    at = Math.min(at + 1024, buf.length);
  }
  expect(last).toEqual({ offset: buf.length, state: "processing" });

  await settleJobs();
  const done = (await get(id)).json();
  expect(done).toMatchObject({ state: "done", duplicate: false, error: null, offset: buf.length });
  expect(done.media).toMatchObject({ kind: "image", caption: "Tram 28", originalName: "lisbon.jpg", takenAt: "2023-05-04T11:12:13.000Z" });
  expect(done.media.lat).toBeCloseTo(38.7223, 3);

  const row = (await query("SELECT immich_asset_id, created_by FROM media WHERE id = $1", [done.media.id])).rows[0];
  expect(fake.assets.get(row.immich_asset_id)!.bytes.equals(buf)).toBe(true);
  expect(row.created_by).toBe(ctx.userId);
  await expect(stat(partPath(id))).rejects.toThrow(); // the bytes aren't kept once Immich has them
});

test("a piece can be resent: the server says where to continue", async () => {
  const buf = await jpeg();
  const id = (await create({ filename: "a.jpg", size: buf.length, mime: "image/jpeg" })).json().id;
  await put(id, 0, buf.subarray(0, 100));

  expect((await get(id)).json()).toMatchObject({ offset: 100, state: "receiving" });
  // The first piece again (its answer was lost): 409 with the real offset.
  const again = await put(id, 0, buf.subarray(0, 100));
  expect(again.statusCode).toBe(409);
  expect(again.json().offset).toBe(100);
  // Too far ahead: also 409.
  expect((await put(id, 500, buf.subarray(500, 600))).json().offset).toBe(100);

  const rest = await put(id, 100, buf.subarray(100));
  expect(rest.json()).toEqual({ offset: buf.length, state: "processing" });
  await settleJobs();
  expect((await get(id)).json().state).toBe("done");
});

test("more bytes than the file has, or too much at once, is refused", async () => {
  const id = (await create({ filename: "a.jpg", size: 10, mime: "image/jpeg" })).json().id;
  const over = await put(id, 0, Buffer.alloc(11));
  expect(over.statusCode).toBe(400);
  expect((await get(id)).json().offset).toBe(0);

  const big = (await create({ filename: "big.mp4", size: 100 * 1024 * 1024, mime: "video/mp4" })).json().id;
  const huge = await put(big, 0, Buffer.alloc(33 * 1024 * 1024));
  expect(huge.statusCode).toBe(413);
  expect((await get(big)).json().offset).toBe(0);
});

test("what can't be uploaded is refused before any bytes are sent", async () => {
  expect((await create({ filename: "notes.txt", size: 10, mime: "text/plain" })).statusCode).toBe(400);
  expect((await create({ filename: "logo.svg", size: 10, mime: "image/svg+xml" })).statusCode).toBe(400);
  const huge = await create({ filename: "movie.mp4", size: 21 * 1024 ** 3, mime: "video/mp4" });
  expect(huge.statusCode).toBe(400);
  expect(huge.json().error).toMatch(/21 GB.*20 GB/);
  // iPhone and camera files by name, even without a type.
  for (const filename of ["IMG_0001.HEIC", "DSC_0001.NEF", "clip.mov"]) {
    expect((await create({ filename, size: 10, mime: "" })).statusCode).toBe(201);
  }

  // A place of another family.
  const other = await addUser(ctx, { familyName: "Others", role: "owner" });
  const visit = (await query("INSERT INTO visits (family_id, kind, title) VALUES ($1, 'place', 'Theirs') RETURNING id", [other.familyId])).rows[0].id;
  const bad = await create({ filename: "a.jpg", size: 10, mime: "image/jpeg", linkTo: `visit:${visit}` });
  expect(bad.statusCode).toBe(400);
  expect((await create({ filename: "a.jpg", size: 10, mime: "image/jpeg", linkTo: `trip:${visit}` })).statusCode).toBe(400);
});

test("without Immich, uploads are refused with a clear reason", async () => {
  await query("DELETE FROM family_immich");
  forgetFamilyConn();
  const r = await create({ filename: "a.jpg", size: 10, mime: "image/jpeg" });
  expect(r.statusCode).toBe(409);
  expect(r.json().error).toMatch(/Photos need Immich/);
});

test("a photo added for a place is linked to it, even though nobody waits for it", async () => {
  const visit = (await query("INSERT INTO visits (family_id, kind, title) VALUES ($1, 'place', 'Sintra') RETURNING id", [ctx.familyId])).rows[0].id;
  const { id } = await uploadAll(await jpeg(), { linkTo: `visit:${visit}`, linkRole: "appears_in" });
  await settleJobs();
  const media = (await get(id)).json().media;
  const link = (await query("SELECT from_id, to_id, role, created_by FROM links WHERE family_id = $1", [ctx.familyId])).rows[0];
  expect(link).toMatchObject({ from_id: media.id, to_id: visit, role: "appears_in", created_by: ctx.userId });
});

test("a photo added for a trip lands in that trip", async () => {
  const trip = (await query("INSERT INTO trips (family_id, name) VALUES ($1, 'Kyoto') RETURNING id", [ctx.familyId])).rows[0].id;
  const { id } = await uploadAll(await jpeg(), { linkTo: `trip:${trip}` });
  await settleJobs();
  const media = (await get(id)).json().media;
  expect(media.tripId).toBe(trip);
  // Someone else's trip is refused before any bytes.
  const other = await addUser(ctx, { familyName: "Them", role: "owner" });
  const theirs = (await query("INSERT INTO trips (family_id, name) VALUES ($1, 'Theirs') RETURNING id", [other.familyId])).rows[0].id;
  expect((await create({ filename: "a.jpg", size: 10, mime: "image/jpeg", linkTo: `trip:${theirs}` })).statusCode).toBe(400);
});

test("a file already in the library comes back as a duplicate, restored if it was in Immich's trash", async () => {
  const buf = await jpeg();
  const first = await uploadAll(buf);
  await settleJobs();
  const firstMedia = (await get(first.id)).json().media;

  const again = await uploadAll(buf);
  await settleJobs();
  expect((await get(again.id)).json()).toMatchObject({ state: "done", duplicate: true, media: { id: firstMedia.id } });

  // Deleted in Werejugo (so it's in Immich's trash), then uploaded again: it comes back.
  const del = await ctx.app.inject({ method: "DELETE", url: `/api/media/${firstMedia.id}`, headers: bearer(ctx.token) });
  expect(del.statusCode).toBe(204);
  const assetId = [...fake.assets.values()][0].id;
  expect(fake.assets.get(assetId)!.trashedAt).not.toBeNull();
  const third = await uploadAll(buf);
  await settleJobs();
  const t = (await get(third.id)).json();
  expect(t).toMatchObject({ state: "done", duplicate: true });
  expect(fake.assets.get(assetId)!.trashedAt).toBeNull();
  expect((await query("SELECT immich_asset_id FROM media WHERE id = $1", [t.media.id])).rows[0].immich_asset_id).toBe(assetId);
});

test("a file Immich refuses fails with Immich's reason, and its bytes are dropped", async () => {
  const buf = Buffer.from("not really a photo");
  const { id } = await uploadAll(buf, { filename: "odd.bmpx", mime: "image/x-odd" });
  await settleJobs();
  const r = (await get(id)).json();
  expect(r).toMatchObject({ state: "failed", canRetry: false });
  expect(r.error).toMatch(/Unsupported file type/);
  await expect(stat(partPath(id))).rejects.toThrow();
});

test("when Immich can't be reached the upload fails, keeps its bytes, and Retry finishes it", async () => {
  const buf = await jpeg();
  fake.failNext("uploadAsset", 503);
  const { id } = await uploadAll(buf);
  await settleJobs();
  const failed = (await get(id)).json();
  expect(failed).toMatchObject({ state: "failed", canRetry: true });
  expect(failed.error).toMatch(/Immich/);

  const retry = await ctx.app.inject({ method: "POST", url: `/api/media/uploads/${id}/retry`, headers: bearer(ctx.token) });
  expect(retry.statusCode, retry.body).toBe(200);
  expect(retry.json().state).toBe("processing");
  await settleJobs();
  expect((await get(id)).json()).toMatchObject({ state: "done", duplicate: false });
});

test("a passing problem is left for the job queue to try again (not marked failed early)", async () => {
  const buf = await jpeg();
  const c = (await create({ filename: "a.jpg", size: buf.length, mime: "image/jpeg" })).json();
  // Received fully, but not handed off yet (as when the queue picks it up).
  await writeFile(partPath(c.id), buf);
  await query("UPDATE media_uploads SET received = size, state = 'processing' WHERE id = $1", [c.id]);
  fake.failNext("uploadAsset", 503);
  await expect(handOff(c.id, { finalAttempt: false })).rejects.toThrow();
  expect((await get(c.id)).json().state).toBe("processing");
  await handOff(c.id, { finalAttempt: false });
  expect((await get(c.id)).json().state).toBe("done");
});

test("cancelling removes the upload and its bytes; the list shows my unfinished uploads", async () => {
  const buf = await jpeg();
  const a = (await create({ filename: "a.jpg", size: buf.length, mime: "image/jpeg" })).json().id;
  await put(a, 0, buf.subarray(0, 50));
  const b = (await uploadAll(buf)).id;
  await settleJobs();

  const list = (await ctx.app.inject({ method: "GET", url: "/api/media/uploads", headers: bearer(ctx.token) })).json().items;
  expect(list.map((u: Json) => [u.id, u.state, u.offset])).toEqual([[a, "receiving", 50], [b, "done", buf.length]]);
  expect(list[1].media.id).toBeTruthy();
  // Someone else in the family doesn't see mine in their list.
  const partner = await addUser(ctx, { familyId: ctx.familyId });
  expect((await ctx.app.inject({ method: "GET", url: "/api/media/uploads", headers: bearer(partner.token) })).json().items).toEqual([]);

  const del = await ctx.app.inject({ method: "DELETE", url: `/api/media/uploads/${a}`, headers: bearer(ctx.token) });
  expect(del.statusCode).toBe(204);
  expect((await get(a)).statusCode).toBe(404);
  await expect(stat(partPath(a))).rejects.toThrow();
});

test("another family's upload is not found, whatever the route", async () => {
  const buf = await jpeg();
  const id = (await create({ filename: "a.jpg", size: buf.length, mime: "image/jpeg" })).json().id;
  const other = await addUser(ctx, { familyName: "Snoops", role: "owner" });
  expect((await get(id, other.token)).statusCode).toBe(404);
  expect((await put(id, 0, buf, other.token)).statusCode).toBe(404);
  expect((await ctx.app.inject({ method: "POST", url: `/api/media/uploads/${id}/retry`, headers: bearer(other.token) })).statusCode).toBe(404);
  expect((await ctx.app.inject({ method: "DELETE", url: `/api/media/uploads/${id}`, headers: bearer(other.token) })).statusCode).toBe(404);
  expect((await get(id)).json().offset).toBe(0);
});

test("the daily cleanup removes abandoned uploads, old failures and stray files", async () => {
  const buf = await jpeg();
  const stale = (await create({ filename: "old.jpg", size: buf.length, mime: "image/jpeg" })).json().id;
  const fresh = (await create({ filename: "new.jpg", size: buf.length, mime: "image/jpeg" })).json().id;
  const stuck = (await create({ filename: "stuck.jpg", size: buf.length, mime: "image/jpeg" })).json().id;
  await query("UPDATE media_uploads SET updated_at = now() - interval '3 days' WHERE id = $1", [stale]);
  await query("UPDATE media_uploads SET state = 'processing', received = size, updated_at = now() - interval '7 hours' WHERE id = $1", [stuck]);
  const stray = join(config.uploadsDir, "incoming", "00000000-0000-4000-8000-000000000000.part");
  await mkdir(join(config.uploadsDir, "incoming"), { recursive: true });
  await writeFile(stray, "x");
  const old = new Date(Date.now() - 2 * 3600_000);
  await utimes(stray, old, old);

  const r = await cleanupUploads();
  expect(r).toEqual({ removed: 1, orphans: 1 });
  expect((await get(stale)).statusCode).toBe(404);
  expect((await get(fresh)).json().state).toBe("receiving");
  expect((await get(stuck)).json()).toMatchObject({ state: "failed", canRetry: true });
  const left = await readdir(join(config.uploadsDir, "incoming"));
  expect(left).not.toContain("00000000-0000-4000-8000-000000000000.part");
  expect(left).toContain(`${fresh}.part`);
});
