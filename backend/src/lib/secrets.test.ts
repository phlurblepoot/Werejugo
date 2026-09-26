import { expect, test } from "vitest";
import { resolveSecrets } from "./secrets.js";

const GOOD = "a".repeat(64);

test("production refuses a missing JWT_SECRET", () => {
  expect(() => resolveSecrets({ NODE_ENV: "production" })).toThrow(/JWT_SECRET/);
});

test("production refuses the old placeholder secrets", () => {
  for (const s of ["please-change-this-to-a-long-random-secret", "change-me-in-production"]) {
    expect(() => resolveSecrets({ NODE_ENV: "production", JWT_SECRET: s })).toThrow(/placeholder/);
  }
});

test("production refuses a short secret and says how to make one", () => {
  expect(() => resolveSecrets({ NODE_ENV: "production", JWT_SECRET: "short-secret" })).toThrow(/openssl rand -hex 32/);
});

test("production accepts a long random secret", () => {
  const s = resolveSecrets({ NODE_ENV: "production", JWT_SECRET: GOOD });
  expect(s.jwtSecret).toBe(GOOD);
  expect(s.warnings).toEqual([]);
});

test("outside production a weak secret is allowed with a warning", () => {
  const s = resolveSecrets({ NODE_ENV: "development" });
  expect(s.jwtSecret.length).toBeGreaterThan(0);
  expect(s.warnings.join(" ")).toMatch(/JWT_SECRET/);
});

test("file signing uses FILE_SIGNING_SECRET when set", () => {
  const s = resolveSecrets({ NODE_ENV: "production", JWT_SECRET: GOOD, FILE_SIGNING_SECRET: "f".repeat(40) });
  expect(s.fileSigningSecret).toBe("f".repeat(40));
});

test("file signing is derived from, but never equal to, the JWT secret", () => {
  const s = resolveSecrets({ NODE_ENV: "production", JWT_SECRET: GOOD });
  expect(s.fileSigningSecret).not.toBe(GOOD);
  expect(s.fileSigningSecret).toMatch(/^[0-9a-f]{64}$/);
  // stable across calls, so signed URLs survive a restart
  expect(resolveSecrets({ NODE_ENV: "production", JWT_SECRET: GOOD }).fileSigningSecret).toBe(s.fileSigningSecret);
});
