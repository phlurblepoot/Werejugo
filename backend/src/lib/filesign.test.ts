import { expect, test, vi } from "vitest";

test("a freshly signed url verifies", async () => {
  vi.resetModules();
  process.env.JWT_SECRET = "test-secret";
  const { signFileUrl, verifyFileToken } = await import("./filesign.js");
  const url = signFileUrl("trips/2024-italy/photos/a.jpg");
  const params = new URL("http://x" + url.slice(url.indexOf("/api/files"))).searchParams;
  expect(
    verifyFileToken("trips/2024-italy/photos/a.jpg", params.get("exp")!, params.get("sig")!),
  ).toBe(true);
});

test("a tampered path fails verification", async () => {
  vi.resetModules();
  process.env.JWT_SECRET = "test-secret";
  const { signFileUrl, verifyFileToken } = await import("./filesign.js");
  const url = signFileUrl("trips/2024-italy/photos/a.jpg");
  const params = new URL("http://x" + url.slice(url.indexOf("/api/files"))).searchParams;
  expect(verifyFileToken("trips/2024-italy/photos/secret.jpg", params.get("exp")!, params.get("sig")!)).toBe(false);
});

test("an expired token fails verification", async () => {
  vi.resetModules();
  process.env.JWT_SECRET = "test-secret";
  const { verifyFileToken, signPath } = await import("./filesign.js");
  const past = String(Date.now() - 1000);
  const sig = signPath("a.jpg", past);
  expect(verifyFileToken("a.jpg", past, sig)).toBe(false);
});
