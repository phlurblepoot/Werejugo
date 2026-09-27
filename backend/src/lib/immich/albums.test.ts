import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { query } from "../../db/pool.js";
import { startFakeImmich, type FakeImmich } from "../../test/fake-immich.js";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx, type TestUser } from "../../test/helpers.js";
import { connectToFake } from "../../test/photos.js";
import { settleJobs } from "../jobs.js";
import { forgetFamilyConn } from "./provision.js";
import { syncFamily } from "./sync.js";
import { syncAlbums } from "./albums.js";

let ctx: TestCtx;
let smiths: TestUser;
let fake: FakeImmich;
let ours = "";   // our Immich user
let theirs = ""; // the Smiths'
beforeAll(async () => {
  ctx = await buildTestApp();
  smiths = await addUser(ctx, { familyName: "The Smiths", role: "owner" });
});
afterAll(async () => { await closeTestApp(ctx); });
beforeEach(async () => {
  fake = await startFakeImmich();
  ({ immichUserId: ours } = await connectToFake(fake, ctx.userId, ctx.familyId));
  ({ immichUserId: theirs } = await connectToFake(fake, ctx.userId, smiths.familyId));
});
afterEach(async () => {
  await settleJobs();
  await fake.close();
  forgetFamilyConn();
  await query("DELETE FROM trip_albums");
  await query("DELETE FROM media");
  await query("DELETE FROM trip_members");
  await query("DELETE FROM trips");
  await query("DELETE FROM family_immich");
  await query("DELETE FROM immich_server");
});

const trip = async (name: string, familyId = ctx.familyId) =>
  (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1, $2) RETURNING id", [familyId, name])).rows[0].id;
/** Photos in Immich, synced into Werejugo; returns their Immich ids. */
async function photos(n: number, owner = ours, familyId = ctx.familyId): Promise<string[]> {
  const ids = Array.from({ length: n }, () => fake.addAsset(owner).id);
  await syncFamily(familyId, { full: true });
  return ids;
}
const putInTrip = (assetIds: string[], tripId: string | null) =>
  query("UPDATE media SET trip_id = $2 WHERE immich_asset_id = ANY($1::uuid[])", [assetIds, tripId]);
const tripOf = async (assetId: string) =>
  (await query<{ trip_id: string | null }>("SELECT trip_id FROM media WHERE immich_asset_id = $1", [assetId])).rows[0]?.trip_id ?? null;
const albumFor = async (tripId: string, familyId = ctx.familyId) => {
  const row = (await query<{ immich_album_id: string | null }>("SELECT immich_album_id FROM trip_albums WHERE family_id = $1 AND trip_id = $2", [familyId, tripId])).rows[0];
  return row?.immich_album_id ? fake.albums.get(row.immich_album_id) : undefined;
};
const contents = async (tripId: string, familyId = ctx.familyId) => [...((await albumFor(tripId, familyId))?.assetIds ?? [])].sort();
const sorted = (a: string[]) => [...a].sort();

test("the triggers mark a family's albums when a photo changes trip or a trip is renamed; a deleted trip leaves its row", async () => {
  const [italy, spain] = [await trip("Italy"), await trip("Spain")];
  const [a] = await photos(1);
  await putInTrip([a], italy);
  const dirty = async () => (await query<{ trip_id: string | null; dirty: boolean }>(
    "SELECT trip_id, dirty FROM trip_albums WHERE family_id = $1 ORDER BY trip_id", [ctx.familyId])).rows;
  expect(await dirty()).toEqual([{ trip_id: italy, dirty: true }]);
  await syncAlbums(ctx.familyId);
  expect((await dirty()).every((r) => !r.dirty)).toBe(true);

  await putInTrip([a], spain);
  expect((await dirty()).every((r) => r.dirty)).toBe(true);
  await syncAlbums(ctx.familyId);
  await query("UPDATE trips SET name = 'España' WHERE id = $1", [spain]);
  expect((await dirty()).find((r) => r.trip_id === spain)?.dirty).toBe(true);
  expect((await dirty()).find((r) => r.trip_id === italy)?.dirty).toBe(false);

  await query("DELETE FROM trips WHERE id = $1", [italy]);
  expect((await dirty()).map((r) => r.trip_id)).toContain(null);
});

test("every trip the family is on gets an album with its photos, empty ones too", async () => {
  const italy = await trip("Italy 2024");
  const empty = await trip("Someday");
  const [a, b, c] = await photos(3);
  await putInTrip([a, b], italy);
  const r = await syncAlbums(ctx.familyId);
  expect(r).toMatchObject({ created: 2, added: 2, errors: 0 });
  expect(await contents(italy)).toEqual(sorted([a, b]));
  expect((await albumFor(italy))!.name).toBe("Italy 2024");
  expect((await albumFor(italy))!.description).toMatch(/Werejugo/);
  expect(await contents(empty)).toEqual([]);
  expect(await tripOf(c)).toBeNull();
  // Nothing changed: nothing made or read again.
  const before = fake.calls.length;
  expect(await syncAlbums(ctx.familyId)).toMatchObject({ created: 0, reconciled: 0 });
  expect(fake.calls.slice(before)).toEqual(["listAlbums"]);
});

test("Werejugo → Immich: moving photos between trips, renaming a trip, deleting a trip (the photos stay)", async () => {
  const [italy, spain] = [await trip("Italy"), await trip("Spain")];
  const [a, b] = await photos(2);
  await putInTrip([a, b], italy);
  await syncAlbums(ctx.familyId);

  await putInTrip([b], spain);
  await putInTrip([a], null);
  expect(await syncAlbums(ctx.familyId)).toMatchObject({ added: 1, removed: 2, joined: 0, left: 0 });
  expect(await contents(italy)).toEqual([]);
  expect(await contents(spain)).toEqual([b]);

  await query("UPDATE trips SET name = 'Spain & Portugal' WHERE id = $1", [spain]);
  await syncAlbums(ctx.familyId);
  expect((await albumFor(spain))!.name).toBe("Spain & Portugal");

  const spainAlbum = (await albumFor(spain))!.id;
  await query("DELETE FROM trips WHERE id = $1", [spain]);
  expect(await syncAlbums(ctx.familyId)).toMatchObject({ deleted: 1 });
  expect(fake.albums.has(spainAlbum)).toBe(false);
  expect(fake.assets.has(b)).toBe(true);
  expect((await query("SELECT count(*)::int AS n FROM trip_albums WHERE trip_id IS NULL")).rows[0].n).toBe(0);
});

test("Immich → Werejugo: a photo added to the album joins the trip; removed from it, it leaves", async () => {
  const italy = await trip("Italy");
  const [a, b] = await photos(2);
  await putInTrip([a], italy);
  await syncAlbums(ctx.familyId);
  const album = (await albumFor(italy))!;

  // In Immich's app: add b, remove a.
  album.assetIds.push(b);
  album.assetIds = album.assetIds.filter((x) => x !== a);
  album.updatedAt = new Date(Date.now() + 1000).toISOString();
  expect(await syncAlbums(ctx.familyId)).toMatchObject({ joined: 1, left: 1, added: 0, removed: 0 });
  expect(await tripOf(b)).toBe(italy);
  expect(await tripOf(a)).toBeNull();

  // A photo Werejugo doesn't have yet joins once the library sync brings it in.
  const c = fake.addAsset(ours).id;
  album.assetIds.push(c);
  album.updatedAt = new Date(Date.now() + 2000).toISOString();
  expect(await syncAlbums(ctx.familyId)).toMatchObject({ joined: 0, errors: 0 });
  await syncFamily(ctx.familyId, { full: true });
  expect(await syncAlbums(ctx.familyId, { full: true })).toMatchObject({ joined: 1 });
  expect(await tripOf(c)).toBe(italy);
});

test("both sides at once: Werejugo wins for the same photo; adding to a second album in Immich moves it", async () => {
  const [italy, spain] = [await trip("Italy"), await trip("Spain")];
  const [a, b] = await photos(2);
  await putInTrip([b], italy);
  await syncAlbums(ctx.familyId);
  const bump = (al: { updatedAt: string }) => { al.updatedAt = new Date(Date.parse(al.updatedAt) + 1000).toISOString(); };

  // Between two passes: Werejugo puts a in Italy, and in Immich a is added to Spain's album.
  await putInTrip([a], italy);
  const spainAlbum = (await albumFor(spain))!;
  spainAlbum.assetIds.push(a);
  bump(spainAlbum);
  // Spain's album first (the worse order): a stays in Italy, and leaves Spain's album.
  await query("UPDATE trip_albums SET dirty = true WHERE trip_id = $1", [spain]);
  await syncAlbums(ctx.familyId);
  expect(await tripOf(a)).toBe(italy);
  expect(await contents(spain)).toEqual([]);
  expect(await contents(italy)).toEqual(sorted([a, b]));

  // In Immich, b (in Italy since the last pass) is added to Spain's album too: it moves to Spain.
  spainAlbum.assetIds.push(b);
  bump(spainAlbum);
  await syncAlbums(ctx.familyId);
  await syncAlbums(ctx.familyId); // Italy's album lets go of it on its next pass
  expect(await tripOf(b)).toBe(spain);
  expect(await contents(spain)).toEqual([b]);
  expect(await contents(italy)).toEqual([a]);
});

test("an album deleted in Immich is made again, with the trip's photos", async () => {
  const italy = await trip("Italy");
  const [a, b] = await photos(2);
  await putInTrip([a, b], italy);
  await syncAlbums(ctx.familyId);
  const first = (await albumFor(italy))!.id;
  fake.albums.delete(first);
  expect(await syncAlbums(ctx.familyId)).toMatchObject({ created: 1, left: 0 });
  expect((await albumFor(italy))!.id).not.toBe(first);
  expect(await contents(italy)).toEqual(sorted([a, b]));
  expect(await tripOf(a)).toBe(italy);
});

test("a shared trip: each family's album holds its own photos; a family that left isn't synced", async () => {
  const tahoe = await trip("Tahoe");
  await query("INSERT INTO trip_members (trip_id, family_id, role) VALUES ($1, $2, 'contributor')", [tahoe, smiths.familyId]);
  const [ourPhoto] = await photos(1);
  const [theirPhoto] = await photos(1, theirs, smiths.familyId);
  await putInTrip([ourPhoto], tahoe);
  await putInTrip([theirPhoto], tahoe);
  await syncAlbums(ctx.familyId);
  await syncAlbums(smiths.familyId);
  expect(await contents(tahoe)).toEqual([ourPhoto]);
  expect(await contents(tahoe, smiths.familyId)).toEqual([theirPhoto]);
  expect((await albumFor(tahoe, smiths.familyId))!.ownerId).toBe(theirs);

  // The Smiths leave: their album stays in Immich but isn't kept in step.
  await query("DELETE FROM trip_members WHERE trip_id = $1", [tahoe]);
  const [later] = await photos(1, theirs, smiths.familyId);
  await putInTrip([later], tahoe);
  expect(await syncAlbums(smiths.familyId)).toMatchObject({ albums: 0, added: 0 });
  expect(await contents(tahoe, smiths.familyId)).toEqual([theirPhoto]);
});

test("a failing album is recorded and the others carry on", async () => {
  const [italy, spain] = [await trip("Italy"), await trip("Spain")];
  await syncAlbums(ctx.familyId);
  const [a] = await photos(1);
  await putInTrip([a], italy);
  const [b] = await photos(1);
  await putInTrip([b], spain);
  fake.failNext("addToAlbum", 500);
  const r = await syncAlbums(ctx.familyId);
  expect(r.errors).toBe(1);
  const errors = (await query<{ last_error: string | null }>("SELECT last_error FROM trip_albums WHERE last_error IS NOT NULL")).rows;
  expect(errors).toHaveLength(1);
  expect(r.added).toBe(1);
  // It's tried again next time, and the error clears.
  await query("UPDATE trip_albums SET dirty = true");
  expect(await syncAlbums(ctx.familyId)).toMatchObject({ errors: 0 });
  expect(await contents(italy)).toEqual([a]);
  expect((await query("SELECT count(*)::int AS n FROM trip_albums WHERE last_error IS NOT NULL")).rows[0].n).toBe(0);
});

test("changes through the API reach the album without waiting for the sync; the trip says where its album is", async () => {
  const italy = await trip("Italy");
  const [a] = await photos(1);
  await syncAlbums(ctx.familyId);
  const mediaId = (await query<{ id: string }>("SELECT id FROM media WHERE immich_asset_id = $1", [a])).rows[0].id;
  const res = await ctx.app.inject({ method: "PATCH", url: `/api/media/${mediaId}`, headers: bearer(ctx.token), payload: { tripId: italy } });
  expect(res.statusCode).toBe(200);
  await settleJobs();
  expect(await contents(italy)).toEqual([a]);

  const renamed = await ctx.app.inject({ method: "PATCH", url: `/api/trips/${italy}`, headers: bearer(ctx.token), payload: { name: "Italia" } });
  expect(renamed.statusCode).toBe(200);
  await settleJobs();
  expect((await albumFor(italy))!.name).toBe("Italia");

  const album = (await ctx.app.inject({ method: "GET", url: `/api/trips/${italy}/album`, headers: bearer(ctx.token) })).json();
  expect(album).toMatchObject({ name: "Italia", assetCount: 1, error: null });
  expect(album.syncedAt).toBeTruthy();

  const created = (await ctx.app.inject({ method: "POST", url: "/api/trips", headers: bearer(ctx.token), payload: { name: "Japan" } })).json();
  await settleJobs();
  expect((await albumFor(created.id))!.name).toBe("Japan");
  const deleted = await ctx.app.inject({ method: "DELETE", url: `/api/trips/${created.id}`, headers: bearer(ctx.token) });
  expect(deleted.statusCode).toBe(204);
  await settleJobs();
  expect([...fake.albums.values()].map((x) => x.name)).toEqual(["Italia"]);
});

test("no Immich: no album", async () => {
  await query("DELETE FROM family_immich WHERE family_id = $1", [ctx.familyId]);
  forgetFamilyConn();
  const italy = await trip("Italy");
  expect(await syncAlbums(ctx.familyId)).toMatchObject({ skipped: true });
  expect((await ctx.app.inject({ method: "GET", url: `/api/trips/${italy}/album`, headers: bearer(ctx.token) })).json()).toBeNull();
});
