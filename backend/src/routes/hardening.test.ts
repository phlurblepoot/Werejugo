import { afterAll, beforeAll, expect, test } from "vitest";
import FormData from "form-data";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { config } from "../config.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

test("login is rate limited per client (keyed on Cloudflare's client IP header)", async () => {
  const attempt = (ip: string) => ctx.app.inject({
    method: "POST", url: "/api/auth/login",
    headers: { "cf-connecting-ip": ip },
    payload: { email: "nobody@test.dev", password: "wrong-password" },
  });
  for (let i = 0; i < 10; i++) expect((await attempt("203.0.113.9")).statusCode).toBe(401);
  expect((await attempt("203.0.113.9")).statusCode).toBe(429);
  // another client is unaffected
  expect((await attempt("198.51.100.4")).statusCode).toBe(401);
});

test("API responses carry security headers", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
  expect(res.headers["x-frame-options"]).toBeDefined();
});

test("SVG uploads are refused (they can carry script)", async () => {
  const form = new FormData();
  form.append("file", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { filename: "evil.svg" });
  const res = await ctx.app.inject({
    method: "POST", url: "/api/uploads",
    headers: { authorization: `Bearer ${ctx.token}`, ...form.getHeaders() }, payload: form.getBuffer(),
  });
  expect(res.statusCode).toBe(400);
});

test("previously uploaded files are served inert: no sniffing, no script", async () => {
  await mkdir(config.uploadsDir, { recursive: true });
  await writeFile(join(config.uploadsDir, "old-icon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  const res = await ctx.app.inject({ method: "GET", url: "/uploads/old-icon.svg" });
  expect(res.statusCode).toBe(200);
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
  expect(String(res.headers["content-security-policy"])).toContain("default-src 'none'");
});
