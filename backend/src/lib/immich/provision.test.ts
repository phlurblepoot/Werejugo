import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { query } from "../../db/pool.js";
import { addUser, buildTestApp, closeTestApp, type TestCtx } from "../../test/helpers.js";
import { startFakeImmich, type FakeImmich } from "../../test/fake-immich.js";
import { useSecretBoxForTests } from "../secretbox.js";
import {
  checkFamily, checkServer, familyConn, linkFamily, provisionFamily, provisionNewFamily, saveServer, setFamilyPassword,
  settleProvisioning, unlinkFamily, verifyServer,
} from "./provision.js";
import { immich } from "./client.js";

let ctx: TestCtx;
let fake: FakeImmich;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });
beforeEach(async () => {
  fake = await startFakeImmich();
  await saveServer(fake.url, fake.adminKey, ctx.userId);
});
afterEach(async () => {
  useSecretBoxForTests(null);
  await fake.close();
  await query("DELETE FROM family_immich");
  await query("DELETE FROM immich_server");
});

const row = async (familyId: string) =>
  (await query("SELECT * FROM family_immich WHERE family_id = $1", [familyId])).rows[0];

test("a family gets its own Immich account and key; the key is stored sealed", async () => {
  expect(await provisionFamily(ctx.familyId)).toBe("created");
  const r = await row(ctx.familyId);
  expect(r.immich_email).toMatch(/^test-family-[0-9a-f]{6}@werejugo\.local$/);
  expect(r.api_key_sealed).toMatch(/^v1:/);
  const user = fake.users.get(r.immich_user_id)!;
  expect(user.name).toBe("Test Family");
  expect(user.isAdmin).toBe(false);
  // The sealed key is the family's own key, not the admin's.
  const conn = (await familyConn(ctx.familyId))!;
  expect(conn.key).not.toBe(fake.adminKey);
  expect(r.api_key_sealed).not.toContain(conn.key!);
  expect((await immich.me(conn)).id).toBe(user.id);
});

test("provisioning again leaves a working connection alone", async () => {
  await provisionFamily(ctx.familyId);
  const before = await row(ctx.familyId);
  const users = fake.users.size;
  await provisionFamily(ctx.familyId);
  expect((await row(ctx.familyId)).api_key_id).toBe(before.api_key_id);
  expect(fake.users.size).toBe(users);
});

test("a failure part-way is recorded, and a retry reuses the same Immich account", async () => {
  fake.failNext("createApiKey", 500);
  await expect(provisionFamily(ctx.familyId)).rejects.toThrow(/Injected failure/);
  const half = await row(ctx.familyId);
  expect(half.immich_user_id).toBeTruthy();
  expect(half.api_key_sealed).toBeNull();
  expect(half.last_error).toMatch(/Injected failure/);
  const users = fake.users.size;

  expect(await provisionFamily(ctx.familyId)).toBe("created");
  const done = await row(ctx.familyId);
  expect(done.immich_user_id).toBe(half.immich_user_id);
  expect(done.last_error).toBeNull();
  expect(fake.users.size).toBe(users);
});

test("a key Immich no longer accepts is replaced (re-key), and the old one is removed", async () => {
  await provisionFamily(ctx.familyId);
  const old = await row(ctx.familyId);
  fake.keys.delete(old.api_key_id);
  expect(await checkFamily(ctx.familyId)).toBe("error");
  expect((await row(ctx.familyId)).last_error).toMatch(/Retry/);

  expect(await provisionFamily(ctx.familyId)).toBe("created");
  const now = await row(ctx.familyId);
  expect(now.api_key_id).not.toBe(old.api_key_id);
  expect(now.immich_user_id).toBe(old.immich_user_id);
  expect(await checkFamily(ctx.familyId)).toBe("created");
});

test("after ENCRYPTION_KEY changes, stored keys can't be read: the admin must re-enter the key, then families re-key", async () => {
  await provisionFamily(ctx.familyId);
  useSecretBoxForTests("another-encryption-key-0123456789abcdef");
  await expect(provisionFamily(ctx.familyId)).rejects.toThrow(/Enter the admin key again/);
  expect(await checkFamily(ctx.familyId)).toBe("error");
  await saveServer(fake.url, fake.adminKey, ctx.userId);
  expect(await provisionFamily(ctx.familyId)).toBe("created");
  expect(await checkFamily(ctx.familyId)).toBe("created");
});

test("linking an existing Immich account by its key", async () => {
  const other = await addUser(ctx, { familyName: "The Linkers" });
  // An account made in Immich by hand, with its own key.
  const u = await immich.createUser({ url: fake.url, key: fake.adminKey }, { email: "linkers@home.lan", name: "Linkers", password: "their-password" });
  const s = await immich.login(fake.url, "linkers@home.lan", "their-password");
  const k = await immich.createApiKey({ url: fake.url, token: s.accessToken }, "mine");

  await expect(linkFamily(other.familyId, "wrong")).rejects.toThrow(/rejected that key/);
  await expect(linkFamily(other.familyId, fake.adminKey)).rejects.toThrow(/Immich admin account/);
  await linkFamily(other.familyId, k.secret);
  const r = await row(other.familyId);
  expect(r).toMatchObject({ mode: "linked", immich_user_id: u.id, immich_email: "linkers@home.lan", api_key_id: k.id });

  // The same account can't be connected to a second family.
  await expect(linkFamily(ctx.familyId, k.secret)).rejects.toThrow(/already connected to The Linkers/);
  // A linked account's password isn't Werejugo's to change.
  await expect(setFamilyPassword(other.familyId, "new-password")).rejects.toThrow(/Werejugo created/);
});

test("disconnecting revokes Werejugo's key but keeps the Immich account", async () => {
  await provisionFamily(ctx.familyId);
  const r = await row(ctx.familyId);
  expect(await unlinkFamily(ctx.familyId)).toBe(true);
  expect(await row(ctx.familyId)).toBeUndefined();
  expect(fake.keys.has(r.api_key_id)).toBe(false);
  expect(fake.users.has(r.immich_user_id)).toBe(true);
  expect(await unlinkFamily(ctx.familyId)).toBe(false);
});

test("an owner can set the family's Immich password and then sign in to Immich with it", async () => {
  await provisionFamily(ctx.familyId);
  const r = await row(ctx.familyId);
  await setFamilyPassword(ctx.familyId, "our-family-photos");
  expect((await immich.login(fake.url, r.immich_email, "our-family-photos")).userId).toBe(r.immich_user_id);
});

test("verifying the server: address, admin, permissions", async () => {
  expect(await verifyServer(`${fake.url}/api/`, fake.adminKey)).toEqual({ url: fake.url, version: "3.2.2", supported: true });
  await expect(verifyServer("http://127.0.0.1:1", fake.adminKey)).rejects.toThrow(/can't reach Immich/);
  await expect(verifyServer(fake.url, "nope")).rejects.toThrow(/rejected the API key/);
  const limited = fake.addAdminKey(["user.read", "adminUser.read"]);
  await expect(verifyServer(fake.url, limited)).rejects.toThrow(/missing permissions: adminUser.create, adminUser.update/);
  const fam = await provisionFamily(ctx.familyId).then(() => familyConn(ctx.familyId));
  await expect(verifyServer(fake.url, fam!.key!)).rejects.toThrow(/isn't an Immich admin/);
});

test("the server check records version, support and errors", async () => {
  expect(await checkServer()).toMatchObject({ ok: true, version: "3.2.2", supported: true });
  fake.version = { major: 4, minor: 0, patch: 0, prerelease: null };
  expect(await checkServer()).toMatchObject({ ok: true, version: "4.0.0", supported: false });
  await fake.close();
  expect(await checkServer()).toMatchObject({ ok: false, error: expect.stringMatching(/can't reach/) });
  fake = await startFakeImmich(); // afterEach closes it
});

test("a new family is connected in the background, and a failure never breaks its creation", async () => {
  const a = await addUser(ctx, { familyName: "Fresh" });
  provisionNewFamily(a.familyId);
  await settleProvisioning();
  expect((await row(a.familyId)).api_key_sealed).toMatch(/^v1:/);

  const b = await addUser(ctx, { familyName: "Unlucky" });
  fake.failNext("createUser", 500);
  provisionNewFamily(b.familyId);
  await settleProvisioning();
  expect((await row(b.familyId)).last_error).toMatch(/Injected failure/);
});

test("without Immich set up, new families are simply left alone", async () => {
  await query("DELETE FROM immich_server");
  const a = await addUser(ctx, { familyName: "Later" });
  provisionNewFamily(a.familyId);
  await settleProvisioning();
  expect(await row(a.familyId)).toBeUndefined();
});
