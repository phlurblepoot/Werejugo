import { mkdir, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { absStoragePath } from "../lib/storage.js";
import { signFileUrl } from "../lib/filesign.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

test("serves a file with a valid signature", async () => {
  await mkdir(absStoragePath("loose/2024"), { recursive: true });
  await writeFile(absStoragePath("loose/2024/a.txt"), "hello");
  const url = signFileUrl("loose/2024/a.txt");
  const res = await ctx.app.inject({ method: "GET", url });
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe("hello");
});

test("rejects a bad signature", async () => {
  const res = await ctx.app.inject({
    method: "GET",
    url: "/api/files/loose/2024/a.txt?exp=" + (Date.now() + 1000) + "&sig=deadbeef",
  });
  expect(res.statusCode).toBe(403);
});

test("rejects path traversal", async () => {
  const url = signFileUrl("../../etc/passwd");
  const res = await ctx.app.inject({ method: "GET", url });
  // The HTTP layer normalizes `..` out of the path (→ 404 no route) and the
  // handler's own `..` check rejects any that survive (→ 403). Either way the
  // file is never served — and a valid signature is impossible without the secret.
  expect([403, 404]).toContain(res.statusCode);
});
