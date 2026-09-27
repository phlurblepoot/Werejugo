import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { query } from "../db/pool.js";
import { addUser, bearer, buildTestApp, closeTestApp, type TestCtx, type TestUser } from "../test/helpers.js";
import { startFakeImmich, type FakeImmich } from "../test/fake-immich.js";
import { useSecretBoxForTests } from "../lib/secretbox.js";
import { immich } from "../lib/immich/client.js";
import { settleJobs } from "../lib/jobs.js";

let ctx: TestCtx; // an owner who is also the server admin
let fake: FakeImmich;
let owner: TestUser; // another family's owner (not an admin)
let member: TestUser;
beforeAll(async () => {
  ctx = await buildTestApp();
  owner = await addUser(ctx, { familyName: "The Smiths", role: "owner" });
  member = await addUser(ctx, { familyId: owner.familyId, role: "member" });
});
afterAll(async () => { await closeTestApp(ctx); });
beforeEach(async () => { fake = await startFakeImmich(); });
afterEach(async () => {
  useSecretBoxForTests(null);
  await fake.close();
  await query("DELETE FROM family_immich");
  await query("DELETE FROM immich_server");
});

const as = (token: string) => ({
  get: (url: string) => ctx.app.inject({ method: "GET", url, headers: bearer(token) }),
  put: (url: string, payload: object) => ctx.app.inject({ method: "PUT", url, payload, headers: bearer(token) }),
  post: (url: string, payload: object = {}) => ctx.app.inject({ method: "POST", url, payload, headers: bearer(token) }),
  del: (url: string) => ctx.app.inject({ method: "DELETE", url, headers: bearer(token) }),
});
const admin = () => as(ctx.token);
const configure = () => admin().put("/api/admin/immich", { url: fake.url, adminKey: fake.adminKey });

test("the admin connects Immich: the address and key are checked live, and the key never comes back", async () => {
  const empty = (await admin().get("/api/admin/immich")).json();
  expect(empty).toMatchObject({ configured: false, encryptionReady: true, supportedRange: "3.2 or newer, before 4.0" });

  const bad = await admin().put("/api/admin/immich", { url: "http://127.0.0.1:1", adminKey: fake.adminKey });
  expect(bad.statusCode).toBe(400);
  expect(bad.json().error).toMatch(/can't reach Immich/);
  const wrongKey = await admin().put("/api/admin/immich", { url: fake.url, adminKey: "nope" });
  expect(wrongKey.json().error).toMatch(/rejected the API key/);

  const res = await configure();
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json();
  expect(body).toMatchObject({ configured: true, url: fake.url, check: { ok: true, version: "3.2.2", supported: true } });
  expect(body.families.map((f: { name: string; state: string }) => [f.name, f.state])).toContainEqual(["The Smiths", "none"]);
  expect(res.body).not.toContain(fake.adminKey);
  const stored = (await query("SELECT admin_key_sealed FROM immich_server")).rows[0].admin_key_sealed;
  expect(stored).toMatch(/^v1:/);
  expect(stored).not.toContain(fake.adminKey);

  // Changing only the address keeps the stored key.
  expect((await admin().put("/api/admin/immich", { url: `${fake.url}/` })).statusCode).toBe(200);
  const audit = (await query("SELECT action, target FROM audit_log WHERE action = 'immich.configured'")).rows;
  expect(audit).toHaveLength(2);
});

test("without ENCRYPTION_KEY, Immich can't be turned on, and the page says why", async () => {
  useSecretBoxForTests(undefined);
  expect((await admin().get("/api/admin/immich")).json()).toMatchObject({ encryptionReady: false, encryptionProblem: expect.stringMatching(/ENCRYPTION_KEY is not set/) });
  const res = await configure();
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toMatch(/openssl rand -hex 32/);
});

test("families get their accounts: one at a time, all at once, retry, link, disconnect", async () => {
  await configure();
  const one = await admin().post(`/api/admin/immich/families/${owner.familyId}/connect`);
  expect(one.statusCode, one.body).toBe(200);
  const smiths = one.json().families.find((f: { id: string }) => f.id === owner.familyId);
  expect(smiths).toMatchObject({ state: "created", mode: "created", immichEmail: expect.stringMatching(/^the-smiths-/), lastError: null });
  expect(one.body).not.toMatch(/api_key|sealed|secret/i);

  fake.failNext("createUser", 500);
  const all = await admin().post("/api/admin/immich/connect-all");
  expect(all.statusCode).toBe(200);
  expect(all.json().results).toEqual([expect.objectContaining({ id: ctx.familyId, ok: false, error: expect.stringMatching(/Injected/) })]);
  expect(all.json().families.find((f: { id: string }) => f.id === ctx.familyId).state).toBe("error");
  const retry = await admin().post("/api/admin/immich/connect-all");
  expect(retry.json().results).toEqual([expect.objectContaining({ id: ctx.familyId, ok: true })]);

  const off = await admin().del(`/api/admin/immich/families/${owner.familyId}`);
  expect(off.json().families.find((f: { id: string }) => f.id === owner.familyId).state).toBe("none");
  expect((await admin().del(`/api/admin/immich/families/${owner.familyId}`)).statusCode).toBe(404);

  // Link an account made in Immich by hand.
  await immich.createUser({ url: fake.url, key: fake.adminKey }, { email: "smiths@home.lan", name: "Smiths", password: "p-a-s-s-w-o-r-d" });
  const s = await immich.login(fake.url, "smiths@home.lan", "p-a-s-s-w-o-r-d");
  const key = await immich.createApiKey({ url: fake.url, token: s.accessToken }, "theirs");
  const link = await admin().post(`/api/admin/immich/families/${owner.familyId}/link`, { apiKey: key.secret });
  expect(link.statusCode, link.body).toBe(200);
  expect(link.json().families.find((f: { id: string }) => f.id === owner.familyId)).toMatchObject({ state: "linked", immichEmail: "smiths@home.lan" });
  expect(link.body).not.toContain(key.secret);
  expect((await admin().post(`/api/admin/immich/families/00000000-0000-4000-8000-000000000000/link`, { apiKey: key.secret })).statusCode).toBe(404);

  const actions = (await query("SELECT action FROM audit_log WHERE action LIKE 'immich.%' ORDER BY id")).rows.map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining(["immich.family_connected", "immich.connect_all", "immich.family_disconnected", "immich.family_linked"]));
});

test("the admin check re-tests the server and every family's key", async () => {
  await configure();
  await admin().post(`/api/admin/immich/families/${owner.familyId}/connect`);
  const keyId = (await query("SELECT api_key_id FROM family_immich WHERE family_id = $1", [owner.familyId])).rows[0].api_key_id;
  fake.keys.delete(keyId);
  const res = (await admin().post("/api/admin/immich/check")).json();
  expect(res.families.find((f: { id: string }) => f.id === owner.familyId)).toMatchObject({ state: "error", lastError: expect.stringMatching(/Retry/) });
});

test("only the server admin can see or change the Immich connection", async () => {
  await configure();
  for (const who of [owner, member]) {
    expect((await as(who.token).get("/api/admin/immich")).statusCode).toBe(403);
    expect((await as(who.token).put("/api/admin/immich", { url: "http://evil.example", adminKey: "x" })).statusCode).toBe(403);
    expect((await as(who.token).post(`/api/admin/immich/families/${owner.familyId}/connect`)).statusCode).toBe(403);
    expect((await as(who.token).post("/api/admin/immich/connect-all")).statusCode).toBe(403);
    expect((await as(who.token).del(`/api/admin/immich/families/${ctx.familyId}`)).statusCode).toBe(403);
  }
});

test("a family sees whether Immich is on; owners also get the login, and can set the Immich password", async () => {
  expect((await as(owner.token).get("/api/immich")).json()).toEqual({ enabled: false, state: "none", lastSyncAt: null, photoCount: null });
  await configure();
  await admin().post(`/api/admin/immich/families/${owner.familyId}/connect`);
  await settleJobs(); // the first library sync runs in the background

  const mine = (await as(owner.token).get("/api/immich")).json();
  expect(mine).toMatchObject({ enabled: true, state: "created", url: fake.url, email: expect.stringMatching(/@werejugo\.local$/), mode: "created", canSetPassword: true });
  const theirs = (await as(member.token).get("/api/immich")).json();
  expect(theirs).toEqual({ enabled: true, state: "created", lastSyncAt: expect.any(String), photoCount: 0 });
  expect(Object.keys(theirs)).not.toContain("email");

  expect((await as(member.token).post("/api/immich/password", { password: "long-enough" })).statusCode).toBe(403);
  expect((await as(owner.token).post("/api/immich/password", { password: "short" })).statusCode).toBe(400);
  const set = await as(owner.token).post("/api/immich/password", { password: "smith-family-photos" });
  expect(set.statusCode, set.body).toBe(200);
  expect((await immich.login(fake.url, mine.email, "smith-family-photos")).userId).toBeTruthy();
  expect((await query("SELECT 1 FROM audit_log WHERE action = 'immich.password_set' AND family_id = $1", [owner.familyId])).rowCount).toBe(1);

  // Another family's owner acts only on its own (unconnected) account; the Smiths' password is untouched.
  const other = await addUser(ctx, { familyName: "Others", role: "owner" });
  expect((await as(other.token).post("/api/immich/password", { password: "hijacked-password" })).statusCode).toBe(409);
  expect((await immich.login(fake.url, mine.email, "smith-family-photos")).userId).toBeTruthy();
});

test("a family created from an admin invite is connected to Immich automatically", async () => {
  await configure();
  const inv = await admin().post("/api/admin/family-invites", { note: "cousins" });
  expect(inv.statusCode, inv.body).toBeLessThan(300);
  const token = inv.json().token;
  const acc = await ctx.app.inject({
    method: "POST", url: `/api/invites/${token}/accept`,
    payload: { email: "cousin@test.dev", displayName: "Cousin", password: "cousin-password", familyName: "The Cousins" },
  });
  expect(acc.statusCode, acc.body).toBe(200);
  const { settleProvisioning } = await import("../lib/immich/provision.js");
  await settleProvisioning();
  const fam = (await admin().get("/api/admin/immich")).json().families.find((f: { name: string }) => f.name === "The Cousins");
  expect(fam.state).toBe("created");
});
