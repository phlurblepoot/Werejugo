import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { query } from "../db/pool.js";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { startFakeImmich, type FakeImmich } from "../test/fake-immich.js";
import { connectToFake } from "../test/photos.js";
import { forgetFamilyConn, unlinkFamily } from "../lib/immich/provision.js";
import { mediaUrls, signMediaUrl } from "../lib/media/urls.js";

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

const BYTES = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
async function photo(kind: "image" | "video" = "image") {
  const a = fake.addAsset(immichUserId, { bytes: BYTES, type: kind === "video" ? "VIDEO" : "IMAGE", mime: kind === "video" ? "video/mp4" : "image/jpeg", originalFileName: "Sunset at the lake.jpg" });
  const id = (await query<{ id: string }>(
    "INSERT INTO media (family_id, kind, immich_asset_id, original_name) VALUES ($1, $2, $3, 'Sunset at the lake.jpg') RETURNING id",
    [ctx.familyId, kind, a.id])).rows[0].id;
  return { id, asset: a, urls: mediaUrls({ id, kind }) };
}
const get = (url: string, headers: Record<string, string> = {}) => ctx.app.inject({ method: "GET", url, headers });

test("a signed link serves the photo from Immich, cacheable by the browser, without a login", async () => {
  const { urls } = await photo();
  const res = await get(urls.thumbUrl);
  expect(res.statusCode).toBe(200);
  expect(res.rawPayload.equals(BYTES)).toBe(true);
  expect(res.headers["content-type"]).toMatch(/^image\//);
  expect(res.headers["cache-control"]).toMatch(/^private, max-age=\d+$/);
  expect(Number(/max-age=(\d+)/.exec(String(res.headers["cache-control"]))![1])).toBeGreaterThan(20 * 3600);
  expect(res.headers.etag).toBeTruthy();
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
  // The browser's cached copy is still good: 304, no body.
  const again = await get(urls.thumbUrl, { "if-none-match": String(res.headers.etag) });
  expect(again.statusCode).toBe(304);
  expect(again.rawPayload.length).toBe(0);
});

test("videos seek: a range request gets exactly those bytes", async () => {
  const { urls } = await photo("video");
  const res = await get(urls.videoUrl!, { range: "bytes=10-19" });
  expect(res.statusCode).toBe(206);
  expect(res.headers["content-range"]).toBe(`bytes 10-19/${BYTES.length}`);
  expect(res.headers["accept-ranges"]).toBe("bytes");
  expect(res.rawPayload.toString()).toBe("abcdefghij");
});

test("originals download as a file with their name, and aren't cached", async () => {
  const { urls } = await photo();
  const res = await get(urls.originalUrl);
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''Sunset%20at%20the%20lake.jpg");
  expect(res.headers["cache-control"]).toBe("private, no-store");
});

test("no signature, a forged or expired one, another photo's, or another size's: refused", async () => {
  const { id, urls } = await photo();
  const other = await photo();
  const u = new URL(urls.thumbUrl, "http://x");
  expect((await get(`/api/m/${id}/thumbnail`)).statusCode).toBe(403);
  expect((await get(`/api/m/${id}/thumbnail?e=${u.searchParams.get("e")}&s=forged`)).statusCode).toBe(403);
  expect((await get(`/api/m/${other.id}/thumbnail${u.search}`)).statusCode).toBe(403);
  expect((await get(`/api/m/${id}/original${u.search}`)).statusCode).toBe(403);
  const expired = signMediaUrl(id, "thumbnail", Date.now() - 40 * 3600_000);
  expect((await get(expired)).statusCode).toBe(403);
  expect((await get(`/api/m/${id}/nonsense${u.search}`)).statusCode).toBe(404);
  expect((await get(`/api/m/not-a-uuid/thumbnail${u.search}`)).statusCode).toBe(404);
});

test("a photo gone from Immich is a 404; a video link for a photo is a 404", async () => {
  const { asset, urls } = await photo();
  expect((await get(signMediaUrl(new URL(urls.url, "http://x").pathname.split("/")[3], "video"))).statusCode).toBe(404);
  fake.purgeAsset(asset.id);
  expect((await get(urls.url)).statusCode).toBe(404);
});

test("a family disconnected from Immich can't be served; Immich down is a 502", async () => {
  const { urls } = await photo();
  fake.failNext("thumbnail", 500);
  expect((await get(urls.thumbUrl)).statusCode).toBe(502);
  await unlinkFamily(ctx.familyId);
  expect((await get(urls.thumbUrl)).statusCode).toBe(503);
});
