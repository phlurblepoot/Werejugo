import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { query } from "../db/pool.js";
import { forgetFamilyConn } from "../lib/immich/provision.js";
import { syncFamily } from "../lib/immich/sync.js";
import { startFakeImmich, type FakeImmich } from "../test/fake-immich.js";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx, type TestUser } from "../test/helpers.js";
import { connectToFake } from "../test/photos.js";

let ctx: TestCtx;
let smiths: TestUser;
let fake: FakeImmich;
let ours = "";
beforeAll(async () => {
  ctx = await buildTestApp();
  smiths = await addUser(ctx, { familyName: "The Smiths", role: "owner" });
});
afterAll(async () => { await closeTestApp(ctx); });
beforeEach(async () => {
  fake = await startFakeImmich();
  ({ immichUserId: ours } = await connectToFake(fake, ctx.userId, ctx.familyId));
});
afterEach(async () => {
  await fake.close();
  forgetFamilyConn();
  for (const t of ["share_links", "smart_albums", "links", "media", "people", "trips", "family_immich", "immich_server"]) await query(`DELETE FROM ${t}`);
});

type Json = Record<string, any>;
const get = (url: string, token = ctx.token) => ctx.app.inject({ method: "GET", url, headers: bearer(token) });
const send = (method: "POST" | "PATCH" | "DELETE", url: string, payload?: object, token = ctx.token) =>
  ctx.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });
const mediaOf = async (assetId: string) => (await query<{ id: string }>("SELECT id FROM media WHERE immich_asset_id = $1", [assetId])).rows[0].id;
/** Photos in Immich with descriptions (what the stand-in's "CLIP" matches), synced in. */
async function library(...descs: string[]) {
  const ids = descs.map((d, i) => fake.addAsset(ours, { description: d, fileCreatedAt: new Date(Date.UTC(2024, 5, 1 + i)).toISOString() }).id);
  await syncFamily(ctx.familyId, { full: true });
  return Promise.all(ids.map(mediaOf));
}

test("smart search: Immich's order, within my library and Werejugo's filters", async () => {
  const [beach, sunset, both, cat] = await library("beach day", "red sunset", "sunset on the beach", "the cat");
  const r = (await get("/api/media/search?q=beach sunset")).json();
  expect(r.items.map((m: Json) => m.id)).toEqual([both, sunset, beach]);
  expect(r.nextPage).toBeNull();
  expect(r.items[0].thumbUrl).toMatch(/^\/api\/m\//);
  expect((await get("/api/media/search?q=cat")).json().items.map((m: Json) => m.id)).toEqual([cat]);

  // Werejugo's filters on top: a trip, hidden photos.
  const t = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1, 'Beach week') RETURNING id", [ctx.familyId])).rows[0].id;
  await query("UPDATE media SET trip_id = $1 WHERE id = ANY($2::uuid[])", [t, [beach, both]]);
  expect((await get(`/api/media/search?q=beach sunset&trip=${t}`)).json().items.map((m: Json) => m.id)).toEqual([both, beach]);
  await query("UPDATE media SET hidden_at = now() WHERE id = $1", [both]);
  expect((await get("/api/media/search?q=beach sunset")).json().items.map((m: Json) => m.id)).toEqual([sunset, beach]);
  expect((await get("/api/media/search?q=")).statusCode).toBe(400);
});

test("smart search pages through Immich's results", async () => {
  await library(...Array.from({ length: 130 }, (_, i) => `sunset ${i}`));
  const first = (await get("/api/media/search?q=sunset")).json();
  expect(first.items).toHaveLength(100);
  expect(first.nextPage).toBe(2);
  const second = (await get("/api/media/search?q=sunset&page=2")).json();
  expect(second.items).toHaveLength(30);
  expect(second.nextPage).toBeNull();
});

test("smart search with Immich's machine learning off says why; with no Immich, 503", async () => {
  await fake.close();
  forgetFamilyConn();
  fake = await startFakeImmich({ machineLearning: false });
  await query("DELETE FROM family_immich");
  await query("DELETE FROM immich_server");
  await connectToFake(fake, ctx.userId, ctx.familyId);
  const off = await get("/api/media/search?q=beach");
  expect(off.statusCode).toBe(409);
  expect(off.json().error).toMatch(/machine learning/);

  expect((await get("/api/media/search?q=beach", smiths.token)).statusCode).toBe(503);
});

test("smart albums: save a search with filters, list, rename, change, delete", async () => {
  await library("beach day");
  const grandma = (await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1, 'Grandma') RETURNING id", [ctx.familyId])).rows[0].id;
  const made = await send("POST", "/api/smart-albums", { name: "Beaches with Grandma", filters: { q: "beach", person: grandma, kind: "image", from: "" } });
  expect(made.statusCode, made.body).toBe(201);
  const album = made.json();
  expect(album).toMatchObject({ name: "Beaches with Grandma", filters: { q: "beach", person: grandma, kind: "image" } });
  expect(album.filters.from).toBeUndefined();

  expect((await get("/api/smart-albums")).json().map((a: Json) => a.name)).toEqual(["Beaches with Grandma"]);
  expect((await send("PATCH", `/api/smart-albums/${album.id}`, { name: "Grandma at the beach" })).json().name).toBe("Grandma at the beach");
  expect((await send("PATCH", `/api/smart-albums/${album.id}`, { filters: { q: "sea" } })).json().filters).toEqual({ q: "sea" });

  // Refusals: nothing chosen, someone we can't see, an unknown key.
  expect((await send("POST", "/api/smart-albums", { name: "All", filters: {} })).statusCode).toBe(400);
  const theirs = (await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1, 'Theirs') RETURNING id", [smiths.familyId])).rows[0].id;
  expect((await send("POST", "/api/smart-albums", { name: "X", filters: { person: theirs } })).json().error).toBe("Unknown person");
  expect((await send("POST", "/api/smart-albums", { name: "X", filters: { hidden: "only" } })).statusCode).toBe(400);

  expect((await send("DELETE", `/api/smart-albums/${album.id}`)).statusCode).toBe(204);
  expect((await get("/api/smart-albums")).json()).toEqual([]);
});

test("a shared smart album shows its photos now, only its own family's, and dies with the album", async () => {
  const [a] = await library("sunset over the lake");
  const album = (await send("POST", "/api/smart-albums", { name: "Sunsets", filters: { q: "sunset" } })).json();
  const share = await send("POST", "/api/shares", { targetType: "smart_album", targetId: album.id });
  expect(share.statusCode, share.body).toBe(201);
  const { token } = share.json();
  const pub = async () => (await ctx.app.inject({ method: "GET", url: `/api/share/${token}` })).json();
  expect(await pub()).toMatchObject({ targetType: "smart_album", album: { name: "Sunsets" } });
  expect((await pub()).photos.map((p: Json) => p.id)).toEqual([a]);

  // A new matching photo shows up without doing anything; a hidden one doesn't.
  const [b] = await library("another sunset");
  expect((await pub()).photos.map((p: Json) => p.id).sort()).toEqual([a, b].sort());
  await query("UPDATE media SET hidden_at = now() WHERE id = $1", [b]);
  expect((await pub()).photos.map((p: Json) => p.id)).toEqual([a]);
  expect((await pub()).photos[0].url).toMatch(/^\/api\/m\//);

  // A filter-only album, newest first.
  const all = (await send("POST", "/api/smart-albums", { name: "Photos", filters: { kind: "image" } })).json();
  const t2 = (await send("POST", "/api/shares", { targetType: "smart_album", targetId: all.id })).json().token;
  expect((await ctx.app.inject({ method: "GET", url: `/api/share/${t2}` })).json().photos.map((p: Json) => p.id)).toEqual([a]);

  expect((await get(`/api/shares?targetType=smart_album&targetId=${album.id}`)).json()).toHaveLength(1);
  await send("DELETE", `/api/smart-albums/${album.id}`);
  expect((await ctx.app.inject({ method: "GET", url: `/api/share/${token}` })).statusCode).toBe(404);
  expect((await send("POST", "/api/shares", { targetType: "smart_album", targetId: album.id })).statusCode).toBe(404);
});

test("public trip and album links leave out photos hidden from the library", async () => {
  const [a, b] = await library("one", "two");
  const t = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1, 'Trip') RETURNING id", [ctx.familyId])).rows[0].id;
  await query("UPDATE media SET trip_id = $1", [t]);
  await query("UPDATE media SET hidden_at = now() WHERE id = $1", [b]);
  for (const targetType of ["trip", "album"]) {
    const { token } = (await send("POST", "/api/shares", { targetType, targetId: t })).json();
    expect((await ctx.app.inject({ method: "GET", url: `/api/share/${token}` })).json().photos.map((p: Json) => p.id)).toEqual([a]);
  }
});
