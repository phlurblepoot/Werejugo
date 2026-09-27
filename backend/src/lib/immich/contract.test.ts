import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startFakeImmich, type FakeImmich } from "../../test/fake-immich.js";
import sharp from "sharp";
import { ADMIN_KEY_PERMISSIONS, ImmichError, fetchMedia, fetchPersonThumbnail, immich, normalizeImmichUrl } from "./client.js";
import { isSupported } from "./version.js";

/**
 * The calls Werejugo makes, and the answers it relies on. Runs against the
 * stand-in Immich by default, and against a real Immich when IMMICH_TEST_URL
 * and IMMICH_TEST_ADMIN_KEY are set (the immich-contract CI job) — so the
 * stand-in can't quietly drift from the real thing.
 */
const REAL = process.env.IMMICH_TEST_URL && process.env.IMMICH_TEST_ADMIN_KEY
  ? { url: normalizeImmichUrl(process.env.IMMICH_TEST_URL), adminKey: process.env.IMMICH_TEST_ADMIN_KEY }
  : null;

// The CI job sets this, so a missing key can't quietly fall back to the stand-in.
if (process.env.IMMICH_CONTRACT_REQUIRE_REAL && !REAL) throw new Error("IMMICH_TEST_URL and IMMICH_TEST_ADMIN_KEY must be set");

let fake: FakeImmich | null = null;
let url = "";
let adminKey = "";
beforeAll(async () => {
  if (REAL) ({ url, adminKey } = REAL);
  else {
    fake = await startFakeImmich();
    ({ url, adminKey } = fake);
  }
});
afterAll(async () => { await fake?.close(); });

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ImmichError;
  }
  throw new Error("expected the call to fail");
};
const email = () => `family-contract-${randomBytes(4).toString("hex")}@werejugo.local`;

/** A fresh Immich account with its own "all" key, like a family's. */
async function newFamily(name: string) {
  const e = email();
  await immich.createUser({ url, key: adminKey }, { email: e, name, password: "family-password-1" });
  const s = await immich.login(url, e, "family-password-1");
  return { url, key: (await immich.createApiKey({ url, token: s.accessToken }, "Werejugo")).secret };
}

describe(`Immich contract (${REAL ? `real Immich at ${REAL.url}` : "stand-in"})`, () => {
  test("server answers ping and a supported version without a key", async () => {
    expect((await immich.ping(url)).res).toBe("pong");
    const v = await immich.version(url);
    expect(typeof v.major).toBe("number");
    expect(isSupported(v)).toBe(true);
  });

  test("the admin key belongs to an admin and carries the permissions Werejugo needs", async () => {
    const me = await immich.me({ url, key: adminKey });
    expect(me.isAdmin).toBe(true);
    const key = await immich.currentKey({ url, key: adminKey });
    const perms = new Set(key.permissions as string[]);
    expect(perms.has("all") || ADMIN_KEY_PERMISSIONS.every((p) => perms.has(p))).toBe(true);
  });

  test("a family account: create the user, log in once, mint its own key", async () => {
    const e = email();
    const user = await immich.createUser({ url, key: adminKey }, { email: e, name: "Contract Family", password: "first-password-123" });
    expect(user.email).toBe(e);
    expect(user.isAdmin).toBe(false);

    const session = await immich.login(url, e, "first-password-123");
    expect(session.userId).toBe(user.id);
    const created = await immich.createApiKey({ url, token: session.accessToken }, "Werejugo");
    expect(created.secret.length).toBeGreaterThan(10);
    expect(created.permissions).toEqual(["all"]);

    const familyKey = { url, key: created.secret };
    expect((await immich.me(familyKey)).id).toBe(user.id);
    // The family's key can't do admin things.
    expect((await errorOf(immich.listUsers(familyKey))).kind).toBe("forbidden");
    // The admin can find the user again (used to resume a half-finished setup).
    expect((await immich.listUsers({ url, key: adminKey })).some((u) => u.id === user.id)).toBe(true);

    // Setting a password through the admin key: the new one works, the old one doesn't.
    await immich.setPassword({ url, key: adminKey }, user.id, "second-password-456");
    expect((await immich.login(url, e, "second-password-456")).userId).toBe(user.id);
    expect((await errorOf(immich.login(url, e, "first-password-123"))).kind).toBe("unauthorized");

    // Deleting the key revokes it.
    await immich.deleteApiKey(familyKey, created.id);
    expect((await errorOf(immich.me(familyKey))).kind).toBe("unauthorized");
  });

  test("the same email can't be used twice", async () => {
    const e = email();
    await immich.createUser({ url, key: adminKey }, { email: e, name: "Once", password: "a-password-123" });
    const err = await errorOf(immich.createUser({ url, key: adminKey }, { email: e, name: "Twice", password: "a-password-123" }));
    expect(err.kind).toBe("rejected");
    expect(err.status).toBe(400);
  });

  test("a family's photos: upload, duplicate, info, search, bytes with Range, description, trash", async () => {
    // A family account of its own.
    const e = email();
    const user = await immich.createUser({ url, key: adminKey }, { email: e, name: "Contract Photos", password: "photos-password-1" });
    const session = await immich.login(url, e, "photos-password-1");
    const fam = { url, key: (await immich.createApiKey({ url, token: session.accessToken }, "Werejugo")).secret };
    const started = new Date(Date.now() - 60_000).toISOString();

    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: Math.floor(Math.random() * 255), g: 90, b: 40 } } }).jpeg().toBuffer();
    const meta = { filename: "contract.jpg", fileCreatedAt: "2024-06-10T10:00:00.000Z", fileModifiedAt: "2024-06-10T10:00:00.000Z" };
    const up = await immich.uploadAsset(fam, new Blob([jpeg], { type: "image/jpeg" }), meta);
    expect(up.status).toBe("created");
    const again = await immich.uploadAsset(fam, new Blob([jpeg], { type: "image/jpeg" }), meta);
    expect(again).toEqual({ id: up.id, status: "duplicate" });

    const info = await immich.getAsset(fam, up.id);
    expect(info).toMatchObject({ id: up.id, type: "IMAGE", originalFileName: "contract.jpg", ownerId: user.id });

    const found = await immich.searchAssets(fam, { filter: { updatedAt: { gt: started } }, withExif: true, size: 100 });
    expect(found.items.map((a) => a.id)).toContain(up.id);
    expect(found.items.find((a) => a.id === up.id)?.exifInfo).toBeDefined();
    expect(typeof found.nextCursor === "string" || found.nextCursor === null || found.nextCursor === undefined).toBe(true);

    // Bytes: the whole original, then the first 10 bytes only.
    const whole = await fetchMedia(fam, up.id, "original");
    expect(whole.status).toBe(200);
    expect(Buffer.from(await whole.arrayBuffer()).equals(jpeg)).toBe(true);
    const part = await fetchMedia(fam, up.id, "original", { range: "bytes=0-9" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-9/${jpeg.length}`);
    expect((await part.arrayBuffer()).byteLength).toBe(10);
    // Immich sends an ETag but answers a conditional request for an original
    // with the whole file again (200). Werejugo passes either answer through;
    // browsers cache through Cache-Control, since a photo's link stays the same for hours.
    const etag = whole.headers.get("etag");
    if (etag) {
      const cond = await fetchMedia(fam, up.id, "original", { ifNoneMatch: etag });
      expect([200, 304]).toContain(cond.status);
      await cond.arrayBuffer().catch(() => {});
    }
    // Thumbnails are made in the background: wait for one.
    let thumb: Response | null = null;
    for (let i = 0; i < 40; i++) {
      thumb = await fetchMedia(fam, up.id, "thumbnail");
      if (thumb.status === 200) break;
      await thumb.arrayBuffer().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(thumb!.status).toBe(200);
    expect(thumb!.headers.get("content-type")).toMatch(/^image\//);

    await immich.setDescription(fam, up.id, "Sunset at the lake");
    expect((await immich.getAsset(fam, up.id)).exifInfo?.description).toBe("Sunset at the lake");

    // Another account can't see it.
    const other = await immich.createUser({ url, key: adminKey }, { email: email(), name: "Other", password: "other-password-1" });
    const os = await immich.login(url, other.email, "other-password-1");
    const otherKey = { url, key: (await immich.createApiKey({ url, token: os.accessToken }, "W")).secret };
    expect((await errorOf(immich.getAsset(otherKey, up.id))).kind).toBe("rejected");
    expect((await fetchMedia(otherKey, up.id, "original")).ok).toBe(false);

    // Trash: a plain structured search still includes it (Immich 3.2), so the
    // sync asks for trashedAt = null; asking about trashedAt finds it.
    await immich.trashAssets(fam, [up.id]);
    const plain = await immich.searchAssets(fam, { filter: { updatedAt: { gt: started } }, size: 100 });
    expect(plain.items.find((a) => a.id === up.id)?.isTrashed).toBe(true);
    const live = await immich.searchAssets(fam, { filter: { updatedAt: { gt: started }, trashedAt: { eq: null } }, size: 100 });
    expect(live.items.map((a) => a.id)).not.toContain(up.id);
    const trashed = await immich.searchAssets(fam, { filter: { trashedAt: { gt: started } }, size: 100 });
    expect(trashed.items.map((a) => a.id)).toContain(up.id);
  }, 60_000); // a real Immich takes a few seconds to make the thumbnail

  test("a file uploaded again after it was trashed is a duplicate of the trashed one, and can be restored", async () => {
    const fam = await newFamily("Contract Trash");
    const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: Math.floor(Math.random() * 255), g: 10, b: 200 } } }).jpeg().toBuffer();
    const meta = { filename: "again.jpg", fileCreatedAt: "2024-02-01T09:00:00.000Z", fileModifiedAt: "2024-02-01T09:00:00.000Z" };
    const up = await immich.uploadAsset(fam, new Blob([jpeg], { type: "image/jpeg" }), meta);
    await immich.trashAssets(fam, [up.id]);

    const again = await immich.uploadAsset(fam, new Blob([jpeg], { type: "image/jpeg" }), meta);
    expect(again).toEqual({ id: up.id, status: "duplicate" });
    expect((await immich.getAsset(fam, up.id)).isTrashed).toBe(true);
    await immich.restoreAssets(fam, [up.id]);
    expect((await immich.getAsset(fam, up.id)).isTrashed).toBe(false);
  });

  test("a video clip is a VIDEO whose bytes are served for playback; an AVIF photo is an IMAGE", async () => {
    const fam = await newFamily("Contract Video");
    const clip = await readFile(new URL("../../test/fixtures/clip.webm", import.meta.url));
    const when = { fileCreatedAt: "2024-03-01T12:00:00.000Z", fileModifiedAt: "2024-03-01T12:00:00.000Z" };
    const v = await immich.uploadAsset(fam, new Blob([clip], { type: "video/webm" }), { filename: "clip.webm", ...when });
    expect(v.status).toBe("created");
    expect((await immich.getAsset(fam, v.id)).type).toBe("VIDEO");
    const play = await fetchMedia(fam, v.id, "video");
    expect(play.status).toBe(200);
    expect(play.headers.get("content-type")).toMatch(/^video\//);
    expect((await play.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const avif = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 30, g: Math.floor(Math.random() * 255), b: 90 } } }).avif().toBuffer();
    const p = await immich.uploadAsset(fam, new Blob([avif], { type: "image/avif" }), { filename: "photo.avif", ...when });
    expect(p.status).toBe("created");
    expect((await immich.getAsset(fam, p.id)).type).toBe("IMAGE");
  }, 30_000);

  test("hidden assets can be searched for (how the sync notices Live Photo clips Immich hid); the locked folder can't", async () => {
    const fam = await newFamily("Contract Hidden");
    const r = await immich.searchAssets(fam, { filter: { visibility: { eq: "hidden" as never }, updatedAt: { gt: "2020-01-01T00:00:00.000Z" } }, size: 10 });
    expect(Array.isArray(r.items)).toBe(true);
    // The locked folder needs Immich's PIN-unlocked session, which an API key never has.
    const locked = await errorOf(immich.searchAssets(fam, { filter: { visibility: { in: ["hidden", "locked"] as never } }, size: 10 }));
    expect(locked.status).toBe(401);
  });

  test("people: a face on a photo is listed, found by search, counted, renamed, and has a thumbnail", async () => {
    const fam = await newFamily("Contract Faces");
    const jpeg = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: Math.floor(Math.random() * 255), b: 120 } } }).jpeg().toBuffer();
    const up = await immich.uploadAsset(fam, new Blob([jpeg], { type: "image/jpeg" }), { filename: "grandma.jpg", fileCreatedAt: "2023-12-24T18:00:00.000Z", fileModifiedAt: "2023-12-24T18:00:00.000Z" });
    // What recognition does: a person, and their face on the photo.
    const person = await immich.createPerson(fam, "Contract Person");
    await immich.createFace(fam, { assetId: up.id, personId: person.id, imageWidth: 400, imageHeight: 300, x: 120, y: 60, width: 120, height: 120 });

    expect((await immich.listPeople(fam)).map((p) => p.id)).toContain(person.id);
    const found = await immich.searchAssets(fam, { filter: { personIds: { any: [person.id] } }, size: 10 });
    expect(found.items.map((a) => a.id)).toEqual([up.id]);
    expect(await immich.personStats(fam, person.id)).toBe(1);
    await immich.renamePerson(fam, person.id, "Grandma");
    expect((await immich.listPeople(fam)).find((p) => p.id === person.id)?.name).toBe("Grandma");

    // The face thumbnail is made in the background from the featured face.
    await immich.setPersonFeatureFace(fam, person.id, up.id);
    let thumb: Response | null = null;
    for (let i = 0; i < 40; i++) {
      thumb = await fetchPersonThumbnail(fam, person.id);
      if (thumb.status === 200) break;
      await thumb.arrayBuffer().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(thumb!.status).toBe(200);
    expect(thumb!.headers.get("content-type")).toMatch(/^image\//);
  }, 60_000);

  test("albums: made with a photo, found by search, added to, removed from, renamed and deleted (the photo stays)", async () => {
    const fam = await newFamily("Contract Albums");
    const photo = async (n: number) => {
      const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: n * 40, g: Math.floor(Math.random() * 255), b: 90 } } }).jpeg().toBuffer();
      return immich.uploadAsset(fam, new Blob([jpeg], { type: "image/jpeg" }), { filename: `trip-${n}.jpg`, fileCreatedAt: `2024-06-0${n}T10:00:00.000Z`, fileModifiedAt: `2024-06-0${n}T10:00:00.000Z` });
    };
    const [a, b] = [await photo(1), await photo(2)];
    const album = await immich.createAlbum(fam, "Italy 2024", "Synced with Werejugo", [a.id]);
    expect(album).toMatchObject({ albumName: "Italy 2024", assetCount: 1 });
    const inAlbum = async () => (await immich.searchAssets(fam, { filter: { albumIds: { any: [album.id] }, trashedAt: { eq: null } }, size: 100 })).items.map((x) => x.id).sort();
    const listed = async () => (await immich.listAlbums(fam)).find((x) => x.id === album.id);
    expect(await inAlbum()).toEqual([a.id]);
    expect(await listed()).toMatchObject({ albumName: "Italy 2024", assetCount: 1 });

    // What the sync watches to notice a change made in Immich: updatedAt and assetCount.
    const wait = () => new Promise((r) => setTimeout(r, 20));
    let before = (await listed())!.updatedAt;
    await wait();
    await immich.addToAlbum(fam, album.id, [b.id, a.id]); // a is already in: not an error
    expect(await inAlbum()).toEqual([a.id, b.id].sort());
    const afterAdd = (await listed())!;
    expect(afterAdd.assetCount).toBe(2);
    expect(afterAdd.updatedAt).not.toBe(before);
    before = afterAdd.updatedAt;
    await wait();
    await immich.removeFromAlbum(fam, album.id, [a.id]);
    expect(await inAlbum()).toEqual([b.id]);
    const afterRemove = (await listed())!;
    expect(afterRemove.assetCount).toBe(1);
    expect(afterRemove.updatedAt).not.toBe(before);

    await immich.renameAlbum(fam, album.id, "Italy, summer 2024");
    expect((await listed())!.albumName).toBe("Italy, summer 2024");
    await immich.deleteAlbum(fam, album.id);
    expect(await listed()).toBeUndefined();
    expect((await immich.getAsset(fam, b.id)).id).toBe(b.id);
  }, 60_000);

  test("a file Immich can't take is refused with its reason", async () => {
    const e = email();
    await immich.createUser({ url, key: adminKey }, { email: e, name: "Contract Types", password: "types-password-1" });
    const s = await immich.login(url, e, "types-password-1");
    const fam = { url, key: (await immich.createApiKey({ url, token: s.accessToken }, "W")).secret };
    const err = await errorOf(immich.uploadAsset(fam, new Blob(["hello"], { type: "text/plain" }), {
      filename: "notes.txt", fileCreatedAt: "2024-01-01T00:00:00.000Z", fileModifiedAt: "2024-01-01T00:00:00.000Z",
    }));
    expect(err.kind).toBe("rejected");
    expect(err.message).toMatch(/Unsupported file type/);
  });

  test("a wrong key is refused as unauthorized", async () => {
    expect((await errorOf(immich.me({ url, key: "not-a-real-key" }))).kind).toBe("unauthorized");
  });
});

test("an address nothing answers on is reported as unreachable", async () => {
  const err = await errorOf(immich.ping("http://127.0.0.1:1"));
  expect(err.kind).toBe("unreachable");
  expect(err.message).toMatch(/can't reach Immich/);
});

test("addresses are normalized and checked", () => {
  expect(normalizeImmichUrl("http://192.168.1.10:2283/")).toBe("http://192.168.1.10:2283");
  expect(normalizeImmichUrl(" http://immich.local:2283/api ")).toBe("http://immich.local:2283");
  expect(() => normalizeImmichUrl("ftp://x")).toThrow(/http/);
  expect(() => normalizeImmichUrl("not a url")).toThrow(/address/);
});
