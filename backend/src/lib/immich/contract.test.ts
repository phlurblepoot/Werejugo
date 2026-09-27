import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startFakeImmich, type FakeImmich } from "../../test/fake-immich.js";
import sharp from "sharp";
import { ADMIN_KEY_PERMISSIONS, ImmichError, fetchMedia, immich, normalizeImmichUrl } from "./client.js";
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

    // Trash: gone from the normal search, found when asking about trashedAt.
    await immich.trashAssets(fam, [up.id]);
    const after = await immich.searchAssets(fam, { filter: { updatedAt: { gt: started } }, size: 100 });
    expect(after.items.map((a) => a.id)).not.toContain(up.id);
    const trashed = await immich.searchAssets(fam, { filter: { trashedAt: { gt: started } }, size: 100 });
    expect(trashed.items.map((a) => a.id)).toContain(up.id);
  });

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
