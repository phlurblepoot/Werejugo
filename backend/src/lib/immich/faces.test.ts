import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { query } from "../../db/pool.js";
import { startFakeImmich, type FakeImmich } from "../../test/fake-immich.js";
import { buildTestApp, closeTestApp, type TestCtx } from "../../test/helpers.js";
import { connectToFake } from "../../test/photos.js";
import { forgetFamilyConn } from "./provision.js";
import { reconcilePerson, syncFaces } from "./faces.js";
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
  await query("DELETE FROM links");
  await query("DELETE FROM immich_people");
  await query("DELETE FROM media");
  await query("DELETE FROM people");
  await query("DELETE FROM family_immich");
  await query("DELETE FROM immich_server");
});

const person = async (name: string, familyId = ctx.familyId) =>
  (await query<{ id: string }>("INSERT INTO people (family_id, display_name) VALUES ($1, $2) RETURNING id", [familyId, name])).rows[0].id;
const faceRow = async (immichId: string) =>
  (await query<{ id: string; name: string; photo_count: number | null; person_id: string | null; hidden_in_immich: boolean }>(
    "SELECT id, name, photo_count, person_id, hidden_in_immich FROM immich_people WHERE immich_person_id = $1", [immichId])).rows[0];
const map = (immichId: string, personId: string | null) =>
  query("UPDATE immich_people SET person_id = $2 WHERE immich_person_id = $1", [immichId, personId]);
/** The photos (by Immich asset) tagged with a person by face. */
const faceTags = async (personId: string) =>
  (await query<{ immich_asset_id: string }>(
    `SELECT m.immich_asset_id FROM links l JOIN media m ON m.id = l.from_id
      WHERE l.to_id = $1 AND l.role = 'face' ORDER BY 1`, [personId])).rows.map((r) => r.immich_asset_id).sort();

test("Immich's people come in with their photo counts; renames, hiding and removal follow", async () => {
  const [a, b] = [fake.addAsset(immichUserId), fake.addAsset(immichUserId)];
  const grandma = fake.addPerson(immichUserId, { name: "Grandma" }, [a.id, b.id]);
  const stranger = fake.addPerson(immichUserId, {}, [a.id]);
  await syncFamily(ctx.familyId, { full: true });
  const r = await syncFaces(ctx.familyId, { full: true });
  expect(r).toMatchObject({ people: 2, skipped: false });
  expect(await faceRow(grandma.id)).toMatchObject({ name: "Grandma", photo_count: 2, person_id: null });
  expect((await faceRow(stranger.id)).photo_count).toBe(1);

  grandma.name = "Nonna";
  grandma.isHidden = true;
  grandma.updatedAt = new Date(Date.now() + 1000).toISOString();
  fake.people.delete(stranger.id);
  await syncFaces(ctx.familyId);
  expect(await faceRow(grandma.id)).toMatchObject({ name: "Nonna", hidden_in_immich: true });
  expect(await faceRow(stranger.id)).toBeUndefined();
});

test("mapping a face tags exactly the photos it's in; unmapping removes only face tags", async () => {
  const [a, b, c] = [fake.addAsset(immichUserId), fake.addAsset(immichUserId), fake.addAsset(immichUserId)];
  const face = fake.addPerson(immichUserId, { name: "Grandma" }, [a.id, b.id]);
  await syncFamily(ctx.familyId, { full: true });
  await syncFaces(ctx.familyId, { full: true });
  const grandma = await person("Grandma");
  await map(face.id, grandma);
  expect(await reconcilePerson(ctx.familyId, grandma)).toEqual({ tagged: 2, untagged: 0 });
  expect(await faceTags(grandma)).toEqual([a.id, b.id].sort());

  // Someone tagged photo c by hand; that stays whatever the faces say.
  const cMedia = (await query<{ id: string }>("SELECT id FROM media WHERE immich_asset_id = $1", [c.id])).rows[0].id;
  await query("INSERT INTO links (family_id, from_type, from_id, to_type, to_id, role) VALUES ($1, 'media', $2, 'person', $3, '')", [ctx.familyId, cMedia, grandma]);

  await map(face.id, null);
  expect(await reconcilePerson(ctx.familyId, grandma)).toEqual({ tagged: 0, untagged: 2 });
  expect(await faceTags(grandma)).toEqual([]);
  expect((await query("SELECT count(*)::int AS n FROM links WHERE to_id = $1", [grandma])).rows[0].n).toBe(1);
});

test("two Immich people for the same person (Immich split them) both tag", async () => {
  const [a, b] = [fake.addAsset(immichUserId), fake.addAsset(immichUserId)];
  const young = fake.addPerson(immichUserId, {}, [a.id]);
  const old = fake.addPerson(immichUserId, {}, [b.id]);
  await syncFamily(ctx.familyId, { full: true });
  await syncFaces(ctx.familyId, { full: true });
  const grandpa = await person("Grandpa");
  await map(young.id, grandpa);
  await map(old.id, grandpa);
  await reconcilePerson(ctx.familyId, grandpa);
  expect(await faceTags(grandpa)).toEqual([a.id, b.id].sort());
});

test("a new photo with a known face is tagged at the next sync; a face gone from Immich untags at the nightly one", async () => {
  const a = fake.addAsset(immichUserId);
  const face = fake.addPerson(immichUserId, { name: "Mia" }, [a.id]);
  await syncFamily(ctx.familyId, { full: true });
  await syncFaces(ctx.familyId, { full: true });
  const mia = await person("Mia");
  await map(face.id, mia);
  await reconcilePerson(ctx.familyId, mia);

  // A new photo: Immich recognises Mia in it (her person row doesn't change).
  const b = fake.addAsset(immichUserId);
  fake.addFace(b.id, face.id);
  await query("UPDATE family_immich SET sync_since = now() - interval '1 minute' WHERE family_id = $1", [ctx.familyId]);
  await syncFamily(ctx.familyId);
  const r = await syncFaces(ctx.familyId);
  expect(r.tagged).toBe(1);
  expect(await faceTags(mia)).toEqual([a.id, b.id].sort());

  // Mia merged away in Immich: her face row and tags go.
  fake.people.delete(face.id);
  await syncFaces(ctx.familyId, { full: true });
  expect(await faceTags(mia)).toEqual([]);
});

test("a face can be mapped to another family's person; tags are this family's", async () => {
  const other = (await query<{ id: string }>("INSERT INTO families (name) VALUES ('The Smiths') RETURNING id")).rows[0].id;
  const theirGrandma = await person("Grandma Smith", other);
  const a = fake.addAsset(immichUserId);
  const face = fake.addPerson(immichUserId, {}, [a.id]);
  await syncFamily(ctx.familyId, { full: true });
  await syncFaces(ctx.familyId, { full: true });
  await map(face.id, theirGrandma);
  await reconcilePerson(ctx.familyId, theirGrandma);
  const link = (await query("SELECT family_id, role FROM links WHERE to_id = $1", [theirGrandma])).rows;
  expect(link).toEqual([{ family_id: ctx.familyId, role: "face" }]);
});

test("deleting a person frees their faces for review and takes their tags; a family's faces go with it", async () => {
  const a = fake.addAsset(immichUserId);
  const face = fake.addPerson(immichUserId, {}, [a.id]);
  await syncFamily(ctx.familyId, { full: true });
  await syncFaces(ctx.familyId, { full: true });
  const kid = await person("Kid");
  await map(face.id, kid);
  await reconcilePerson(ctx.familyId, kid);
  expect(await faceTags(kid)).toEqual([a.id]);
  await query("DELETE FROM people WHERE id = $1", [kid]);
  expect((await faceRow(face.id)).person_id).toBeNull();
  expect((await query("SELECT count(*)::int AS n FROM links WHERE role = 'face'")).rows[0].n).toBe(0);

  // The same Immich person can't be in a family twice.
  await expect(query("INSERT INTO immich_people (family_id, immich_person_id) VALUES ($1, $2)", [ctx.familyId, face.id])).rejects.toThrow(/unique/);
  const other = (await query<{ id: string }>("INSERT INTO families (name) VALUES ('Gone') RETURNING id")).rows[0].id;
  await query("INSERT INTO immich_people (family_id, immich_person_id) VALUES ($1, $2)", [other, face.id]);
  await query("DELETE FROM families WHERE id = $1", [other]);
  expect((await query("SELECT count(*)::int AS n FROM immich_people WHERE family_id = $1", [other])).rows[0].n).toBe(0);
});
