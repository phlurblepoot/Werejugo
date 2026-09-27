import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { query } from "../db/pool.js";
import { forgetFamilyConn } from "../lib/immich/provision.js";
import { syncFaces } from "../lib/immich/faces.js";
import { syncFamily } from "../lib/immich/sync.js";
import { signFaceUrl } from "../lib/media/urls.js";
import { startFakeImmich, type FakeImmich } from "../test/fake-immich.js";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx, type TestUser } from "../test/helpers.js";
import { connectToFake } from "../test/photos.js";

let ctx: TestCtx;
let smiths: TestUser;
let fake: FakeImmich;
let immichUserId = "";
beforeAll(async () => {
  ctx = await buildTestApp();
  smiths = await addUser(ctx, { familyName: "The Smiths", role: "owner" });
});
afterAll(async () => { await closeTestApp(ctx); });
beforeEach(async () => {
  fake = await startFakeImmich();
  ({ immichUserId } = await connectToFake(fake, ctx.userId, ctx.familyId));
});
afterEach(async () => {
  await fake.close();
  forgetFamilyConn();
  await query("DELETE FROM links");
  await query("DELETE FROM immich_people");
  await query("DELETE FROM media");
  await query("DELETE FROM person_links");
  await query("DELETE FROM people");
  await query("DELETE FROM trip_members");
  await query("DELETE FROM trips");
  await query("DELETE FROM family_immich");
  await query("DELETE FROM immich_server");
});

type Json = Record<string, any>;
const get = (url: string, token = ctx.token) => ctx.app.inject({ method: "GET", url, headers: bearer(token) });
const send = (method: "POST" | "PATCH", url: string, payload: object, token = ctx.token) =>
  ctx.app.inject({ method, url, headers: bearer(token), payload });
const person = async (name: string, familyId = ctx.familyId) =>
  (await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1, $2) RETURNING id", [familyId, name])).rows[0].id;
const faceId = async (immichId: string) =>
  (await query<{ id: string }>("SELECT id FROM immich_people WHERE immich_person_id = $1", [immichId])).rows[0].id;
const faceTagCount = async (personId: string) =>
  (await query<{ n: number }>("SELECT count(*)::int AS n FROM links WHERE to_id = $1 AND role = 'face'", [personId])).rows[0].n;

/** Photos in Immich, and people in them: `counts` photos each. Synced into Werejugo. */
async function facesIn(...specs: Array<{ name?: string; photos: number; hidden?: boolean }>) {
  const made = [];
  for (const s of specs) {
    const assets = Array.from({ length: s.photos }, () => fake.addAsset(immichUserId).id);
    made.push(fake.addPerson(immichUserId, { name: s.name ?? "", isHidden: s.hidden ?? false }, assets));
  }
  await syncFamily(ctx.familyId, { full: true });
  await syncFaces(ctx.familyId, { full: true });
  return made;
}

test("the review queue: faces in 2+ photos, not hidden, not decided, most photos first", async () => {
  const [few, many, once, hidden] = await facesIn({ photos: 2 }, { name: "Grandma", photos: 4 }, { photos: 1 }, { photos: 3, hidden: true });
  const review = (await get("/api/faces")).json();
  expect(review.map((f: Json) => f.id)).toEqual([await faceId(many.id), await faceId(few.id)]);
  expect(review[0]).toMatchObject({ name: "Grandma", photoCount: 4, ignored: false, hiddenInImmich: false, person: null });
  expect(review[0].thumbUrl).toMatch(/^\/api\/f\/[0-9a-f-]{36}\?e=\d+&s=/);
  expect((await get("/api/faces/count")).json()).toEqual({ review: 2 });

  // The ignored view has the hidden one; "all" has everyone.
  expect((await get("/api/faces?view=ignored")).json().map((f: Json) => f.id)).toEqual([await faceId(hidden.id)]);
  expect((await get("/api/faces?view=all")).json()).toHaveLength(4);
  expect(await faceId(once.id)).toBeTruthy();
  expect((await get("/api/faces?view=nope")).statusCode).toBe(400);
});

test("saying who a face is tags their photos, names the face in Immich, and leaves the queue", async () => {
  const [face] = await facesIn({ photos: 3 });
  const mia = await person("Mia");
  const res = await send("PATCH", `/api/faces/${await faceId(face.id)}`, { personId: mia });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json()).toMatchObject({ tagged: 3, untagged: 0, face: { name: "Mia", person: { id: mia, displayName: "Mia", familyName: null } } });
  expect(face.name).toBe("Mia"); // renamed in Immich too
  expect(await faceTagCount(mia)).toBe(3);
  expect((await get("/api/faces/count")).json()).toEqual({ review: 0 });
  expect((await get("/api/faces?view=mapped")).json().map((f: Json) => f.person.id)).toEqual([mia]);
  expect((await get(`/api/people/${mia}/faces`)).json()).toHaveLength(1);

  // Her photos are in the library's person filter, not in her related list (there can be thousands).
  expect((await get(`/api/media?person=${mia}`)).json().items).toHaveLength(3);
  expect((await get(`/api/relations?entity=person:${mia}`)).json()).toEqual([]);
  // A photo shows who's in it; a face tag isn't removed by hand (the next sync would put it back).
  const photoId = (await get(`/api/media?person=${mia}`)).json().items[0].id;
  const onPhoto = (await get(`/api/relations?entity=media:${photoId}`)).json();
  expect(onPhoto).toMatchObject([{ role: "face", canRemove: false, entity: { type: "person", id: mia } }]);
  // Tagged by hand as well: she's listed once, removable.
  await send("POST", "/api/links", { from: `media:${photoId}`, to: `person:${mia}` });
  expect((await get(`/api/relations?entity=media:${photoId}`)).json()).toMatchObject([{ role: "", canRemove: true, entity: { id: mia } }]);
  expect((await get(`/api/relations?entity=media:${photoId}`)).json()).toHaveLength(1);

  // Moving the face to someone else moves the tags.
  const other = await person("Mia's twin");
  const moved = (await send("PATCH", `/api/faces/${await faceId(face.id)}`, { personId: other })).json();
  expect(moved).toMatchObject({ tagged: 3, untagged: 3 });
  expect(await faceTagCount(mia)).toBe(0);
  expect(face.name).toBe("Mia"); // a face with a name keeps it

  // Unmapping puts it back in the queue.
  const un = (await send("PATCH", `/api/faces/${await faceId(face.id)}`, { personId: null })).json();
  expect(un).toMatchObject({ untagged: 3, face: { person: null } });
  expect((await get("/api/faces/count")).json()).toEqual({ review: 1 });
});

test("a face can be another family's person we share a trip with, but not a stranger's", async () => {
  const [face] = await facesIn({ photos: 2 });
  const theirGrandma = await person("Grandma Smith", smiths.familyId);
  const id = await faceId(face.id);
  expect((await send("PATCH", `/api/faces/${id}`, { personId: theirGrandma })).json()).toEqual({ error: "Unknown person" });

  const trip = (await query<{ id: string }>("INSERT INTO trips (family_id, name) VALUES ($1, 'Tahoe') RETURNING id", [ctx.familyId])).rows[0].id;
  await query("INSERT INTO trip_members (trip_id, family_id, role) VALUES ($1, $2, 'contributor')", [trip, smiths.familyId]);
  const res = (await send("PATCH", `/api/faces/${id}`, { personId: theirGrandma })).json();
  expect(res).toMatchObject({ tagged: 2, face: { person: { id: theirGrandma, displayName: "Grandma Smith", familyName: "The Smiths" } } });
  // Our photos of her: our links, which the Smiths see on her page.
  expect((await query("SELECT DISTINCT family_id FROM links WHERE to_id = $1", [theirGrandma])).rows).toEqual([{ family_id: ctx.familyId }]);
  expect((await get(`/api/people/${theirGrandma}/faces`)).json()).toHaveLength(1);
  // The Smiths don't see our faces.
  expect((await get(`/api/people/${theirGrandma}/faces`, smiths.token)).json()).toEqual([]);
  expect((await get("/api/faces?view=all", smiths.token)).json()).toEqual([]);
});

test("a new person from a face", async () => {
  const [face] = await facesIn({ name: "Uncle Bob", photos: 2 });
  const res = await send("POST", `/api/faces/${await faceId(face.id)}/person`, { displayName: "Bob" });
  expect(res.statusCode, res.body).toBe(201);
  const { personId, tagged, face: f } = res.json();
  expect(tagged).toBe(2);
  expect(f.person).toEqual({ id: personId, displayName: "Bob", familyName: null });
  expect((await query("SELECT display_name, family_id FROM people WHERE id = $1", [personId])).rows[0]).toEqual({ display_name: "Bob", family_id: ctx.familyId });
  expect(face.name).toBe("Uncle Bob"); // Immich's name stays
  expect((await send("POST", `/api/faces/${await faceId(face.id)}/person`, { displayName: " " })).statusCode).toBe(400);
});

test("ignoring a face, and changing our mind", async () => {
  const [face] = await facesIn({ photos: 5 });
  const id = await faceId(face.id);
  expect((await send("PATCH", `/api/faces/${id}`, { ignored: true })).json().face).toMatchObject({ ignored: true, person: null });
  expect((await get("/api/faces/count")).json()).toEqual({ review: 0 });
  expect((await get("/api/faces?view=ignored")).json().map((f: Json) => f.id)).toEqual([id]);

  // Mapping an ignored face un-ignores it.
  const zoe = await person("Zoe");
  expect((await send("PATCH", `/api/faces/${id}`, { personId: zoe })).json().face).toMatchObject({ ignored: false, person: { id: zoe } });
  // Ignoring a mapped face unmaps it and removes its tags.
  expect((await send("PATCH", `/api/faces/${id}`, { ignored: true })).json()).toMatchObject({ untagged: 5, face: { ignored: true, person: null } });
  expect(await faceTagCount(zoe)).toBe(0);
  expect((await send("PATCH", `/api/faces/${id}`, { ignored: false })).json().face).toMatchObject({ ignored: false });
  expect((await get("/api/faces/count")).json()).toEqual({ review: 1 });
});

test("face thumbnails: a signed link, from the face's own family's Immich", async () => {
  const [face] = await facesIn({ photos: 2 });
  const id = await faceId(face.id);
  const url = (await get("/api/faces")).json()[0].thumbUrl;
  const res = await ctx.app.inject({ method: "GET", url }); // no login: the link is the permission
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toBe("image/jpeg");
  expect(res.headers["cache-control"]).toMatch(/^private, max-age=\d+$/);
  expect(fake.calls.filter((c) => c === "personThumbnail")).toHaveLength(1);

  expect((await ctx.app.inject({ method: "GET", url: `/api/f/${id}` })).statusCode).toBe(403);
  expect((await ctx.app.inject({ method: "GET", url: url.replace(/s=[^&]+/, "s=forged") })).statusCode).toBe(403);
  const expired = signFaceUrl(id, Date.now() - 10 * 24 * 3600_000);
  expect((await ctx.app.inject({ method: "GET", url: expired })).statusCode).toBe(403);
  // A signed link for a face that's gone.
  await query("DELETE FROM immich_people WHERE id = $1", [id]);
  expect((await ctx.app.inject({ method: "GET", url })).statusCode).toBe(404);
});

test("faces of an unknown id, and a person we can't see", async () => {
  expect((await send("PATCH", "/api/faces/00000000-0000-0000-0000-000000000000", { ignored: true })).statusCode).toBe(404);
  expect((await send("PATCH", "/api/faces/not-a-uuid", { ignored: true })).statusCode).toBe(404);
  const stranger = await person("Stranger", smiths.familyId);
  expect((await get(`/api/people/${stranger}/faces`)).statusCode).toBe(404);
});
