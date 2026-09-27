import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { query } from "../../db/pool.js";
import { addUser, buildTestApp, closeTestApp, type TestCtx } from "../../test/helpers.js";
import { startFakeImmich, type FakeImmich } from "../../test/fake-immich.js";
import { connectToFake } from "../../test/photos.js";
import { forgetFamilyConn, provisionFamily } from "./provision.js";
import { settleJobs } from "../jobs.js";
import { syncFamily } from "./sync.js";

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

const refs = async (familyId = ctx.familyId) =>
  (await query<{ immich_asset_id: string; kind: string; caption: string; taken_at: Date | null; lat: number | null; lng: number | null; duration_ms: number | null }>(
    "SELECT immich_asset_id, kind, caption, taken_at, ST_Y(geom) AS lat, ST_X(geom) AS lng, duration_ms FROM media WHERE family_id = $1 ORDER BY taken_at",
    [familyId])).rows;
const later = () => new Promise((r) => setTimeout(r, 5));

test("photos added in Immich directly appear, with their date, place, caption and kind", async () => {
  fake.addAsset(immichUserId, { dateTimeOriginal: "2024-06-10T10:00:00.000Z", latitude: 41.89, longitude: 12.49, description: "Rome" });
  fake.addAsset(immichUserId, { type: "VIDEO", mime: "video/mp4", dateTimeOriginal: "2024-06-11T10:00:00.000Z", durationMs: 9000 });
  fake.addAsset(immichUserId, { visibility: "hidden" }); // the video half of a Live Photo
  fake.addAsset(immichUserId, { visibility: "locked" }); // Immich's locked folder
  fake.addAsset(immichUserId, { visibility: "archive", dateTimeOriginal: "2024-06-12T10:00:00.000Z" });

  const r = await syncFamily(ctx.familyId, { full: true });
  expect(r).toMatchObject({ full: true, upserted: 3, removed: 0, skipped: false });
  const rows = await refs();
  expect(rows.map((x) => x.kind)).toEqual(["image", "video", "image"]);
  expect(rows[0]).toMatchObject({ caption: "Rome", lat: 41.89, lng: 12.49 });
  expect(rows[0].taken_at!.toISOString()).toBe("2024-06-10T10:00:00.000Z");
  expect(rows[1].duration_ms).toBe(9000);
  const state = (await query("SELECT sync_since, last_sync_at, last_full_sync_at, asset_count, sync_error FROM family_immich WHERE family_id = $1", [ctx.familyId])).rows[0];
  expect(state).toMatchObject({ asset_count: 3, sync_error: null });
  expect(state.last_full_sync_at).not.toBeNull();

  // Running again changes nothing.
  await syncFamily(ctx.familyId, { full: true });
  expect(await refs()).toHaveLength(3);
});

test("the next syncs pick up new, edited and trashed photos", async () => {
  const a = fake.addAsset(immichUserId, { description: "first" });
  const b = fake.addAsset(immichUserId);
  await syncFamily(ctx.familyId, { full: true });
  await query("UPDATE family_immich SET sync_since = now() - interval '1 second' WHERE family_id = $1", [ctx.familyId]);
  await later();

  const c = fake.addAsset(immichUserId, { description: "new one" });
  a.description = "edited in Immich";
  a.updatedAt = new Date(Date.now() + 1000).toISOString();
  b.trashedAt = new Date(Date.now() + 1000).toISOString();
  b.updatedAt = b.trashedAt;

  const r = await syncFamily(ctx.familyId);
  expect(r).toMatchObject({ full: false, upserted: 2, removed: 1 });
  const byAsset = new Map((await refs()).map((x) => [x.immich_asset_id, x]));
  expect(byAsset.get(a.id)?.caption).toBe("edited in Immich");
  expect(byAsset.has(b.id)).toBe(false);
  expect(byAsset.get(c.id)?.caption).toBe("new one");
});

test("photos in Immich's trash stay out, even though Immich's search includes them", async () => {
  const kept = fake.addAsset(immichUserId);
  const trashed = fake.addAsset(immichUserId);
  await syncFamily(ctx.familyId, { full: true });
  trashed.trashedAt = new Date().toISOString();
  trashed.updatedAt = trashed.trashedAt;

  await syncFamily(ctx.familyId, { full: true });
  expect((await refs()).map((x) => x.immich_asset_id)).toEqual([kept.id]);
});

test("a clip Immich hides after pairing it with its Live Photo leaves at the next sync; a photo moved to the locked folder at the next full one", async () => {
  const clip = fake.addAsset(immichUserId, { type: "VIDEO", mime: "video/quicktime", originalFileName: "IMG_0001.MOV" });
  const locked = fake.addAsset(immichUserId);
  const photo = fake.addAsset(immichUserId, { originalFileName: "IMG_0001.HEIC" });
  await syncFamily(ctx.familyId, { full: true });
  await query("UPDATE family_immich SET sync_since = now() - interval '1 second' WHERE family_id = $1", [ctx.familyId]);
  await later();
  clip.visibility = "hidden";
  locked.visibility = "locked";
  clip.updatedAt = locked.updatedAt = new Date(Date.now() + 1000).toISOString();

  const r = await syncFamily(ctx.familyId);
  expect(r.removed).toBe(1);
  expect((await refs()).map((x) => x.immich_asset_id).sort()).toEqual([locked.id, photo.id].sort());
  await syncFamily(ctx.familyId, { full: true });
  expect((await refs()).map((x) => x.immich_asset_id)).toEqual([photo.id]);
});

test("photos deleted for good in Immich go at the next full sync, but a fresh upload is kept", async () => {
  const a = fake.addAsset(immichUserId);
  await syncFamily(ctx.familyId, { full: true });
  fake.purgeAsset(a.id);
  // A reference created while the full sync runs (an upload in flight) isn't removed.
  const fresh = fake.addAsset(immichUserId);
  fake.purgeAsset(fresh.id); // not in Immich's listing yet…
  const started = new Date(Date.now() + 60_000);
  await query("INSERT INTO media (family_id, kind, immich_asset_id, created_at) VALUES ($1, 'image', $2, $3)", [ctx.familyId, fresh.id, started]);

  const r = await syncFamily(ctx.familyId, { full: true });
  expect(r.removed).toBe(1);
  expect((await refs()).map((x) => x.immich_asset_id)).toEqual([fresh.id]);
});

test("another family's photos never appear, even on the same Immich server", async () => {
  const other = await addUser(ctx, { familyName: "Others", role: "owner" });
  await provisionFamily(other.familyId);
  await settleJobs();
  const theirUser = (await query("SELECT immich_user_id FROM family_immich WHERE family_id = $1", [other.familyId])).rows[0].immich_user_id;
  fake.addAsset(theirUser, { description: "theirs" });
  fake.addAsset(immichUserId, { description: "ours" });
  await syncFamily(ctx.familyId, { full: true });
  await syncFamily(other.familyId, { full: true });
  expect((await refs()).map((x) => x.caption)).toEqual(["ours"]);
  expect((await refs(other.familyId)).map((x) => x.caption)).toEqual(["theirs"]);
});

test("a failing sync is recorded on the family and changes nothing", async () => {
  fake.addAsset(immichUserId);
  fake.failNext("searchAssets", 500);
  await expect(syncFamily(ctx.familyId, { full: true })).rejects.toThrow();
  const state = (await query("SELECT sync_error FROM family_immich WHERE family_id = $1", [ctx.familyId])).rows[0];
  expect(state.sync_error).toMatch(/Injected failure/);
  expect(await refs()).toHaveLength(0);
  await syncFamily(ctx.familyId, { full: true });
  expect((await query("SELECT sync_error FROM family_immich WHERE family_id = $1", [ctx.familyId])).rows[0].sync_error).toBeNull();
});

test("only one sync per family runs at a time", async () => {
  for (let i = 0; i < 20; i++) fake.addAsset(immichUserId);
  const [x, y] = await Promise.all([syncFamily(ctx.familyId, { full: true }), syncFamily(ctx.familyId, { full: true })]);
  expect([x.skipped, y.skipped].sort()).toEqual([false, true]);
  expect(await refs()).toHaveLength(20);
});

test("connecting a family brings in what its account already holds", async () => {
  const other = await addUser(ctx, { familyName: "Newcomers", role: "owner" });
  // Link an account that already has photos: its first sync is a full one.
  await provisionFamily(other.familyId);
  await settleJobs();
  const theirUser = (await query("SELECT immich_user_id FROM family_immich WHERE family_id = $1", [other.familyId])).rows[0].immich_user_id;
  fake.addAsset(theirUser);
  await query("UPDATE family_immich SET sync_since = NULL WHERE family_id = $1", [other.familyId]);
  const r = await syncFamily(other.familyId);
  expect(r.full).toBe(true);
  expect(await refs(other.familyId)).toHaveLength(1);
});
