import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startFakeImmich, type FakeImmich } from "../../test/fake-immich.js";
import { ADMIN_KEY_PERMISSIONS, ImmichError, immich, normalizeImmichUrl } from "./client.js";
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
