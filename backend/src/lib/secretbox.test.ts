import { expect, test } from "vitest";
import { createSecretBox, SecretUnreadable, encryptionKeyProblem } from "./secretbox.js";

const KEY = "k".repeat(64);

test("sealed text opens with the same key, and never contains the plain text", () => {
  const box = createSecretBox(KEY);
  const sealed = box.seal("immich-api-key-123");
  expect(sealed).toMatch(/^v1:/);
  expect(sealed).not.toContain("immich-api-key-123");
  expect(box.open(sealed)).toBe("immich-api-key-123");
});

test("the same text seals differently each time (random IV)", () => {
  const box = createSecretBox(KEY);
  expect(box.seal("x")).not.toBe(box.seal("x"));
});

test("a different key can't open it", () => {
  const sealed = createSecretBox(KEY).seal("secret");
  expect(() => createSecretBox("z".repeat(64)).open(sealed)).toThrow(SecretUnreadable);
});

test("tampering is detected", () => {
  const box = createSecretBox(KEY);
  const sealed = box.seal("secret");
  const raw = Buffer.from(sealed.slice(3), "base64");
  raw[raw.length - 1] ^= 1;
  expect(() => box.open(`v1:${raw.toString("base64")}`)).toThrow(SecretUnreadable);
  expect(() => box.open("garbage")).toThrow(SecretUnreadable);
});

test("without a usable ENCRYPTION_KEY the box refuses to seal and says why", () => {
  expect(encryptionKeyProblem(undefined)).toMatch(/ENCRYPTION_KEY is not set/);
  expect(encryptionKeyProblem("change-me")).toMatch(/placeholder/);
  expect(encryptionKeyProblem("short")).toMatch(/at least 32/);
  expect(encryptionKeyProblem(KEY)).toBeNull();
  const box = createSecretBox(undefined);
  expect(box.ready).toBe(false);
  expect(() => box.seal("x")).toThrow(/ENCRYPTION_KEY/);
});
