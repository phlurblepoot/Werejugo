import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { buildTestApp, closeTestApp, type TestCtx } from "../test/helpers.js";
import { query } from "../db/pool.js";
import { cached } from "./lookupCache.js";

let ctx: TestCtx;
beforeAll(async () => { ctx = await buildTestApp(); });
afterAll(async () => { await closeTestApp(ctx); });

test("an answer is kept until it expires; a failure isn't kept", async () => {
  const fn = vi.fn(async () => ({ n: 1 }));
  expect(await cached("test:a", 60_000, fn)).toEqual({ n: 1 });
  expect(await cached("test:a", 60_000, fn)).toEqual({ n: 1 });
  expect(fn).toHaveBeenCalledTimes(1);

  await query("UPDATE lookup_cache SET expires_at = now() - interval '1 second' WHERE key = 'test:a'");
  expect(await cached("test:a", 60_000, fn)).toEqual({ n: 1 });
  expect(fn).toHaveBeenCalledTimes(2);

  const failing = vi.fn(async () => { throw new Error("down"); });
  await expect(cached("test:b", 60_000, failing)).rejects.toThrow("down");
  await expect(cached("test:b", 60_000, failing)).rejects.toThrow("down");
  expect(failing).toHaveBeenCalledTimes(2);

  // `null` is an answer too ("nothing found").
  const none = vi.fn(async () => null);
  expect(await cached("test:c", 60_000, none)).toBeNull();
  expect(await cached("test:c", 60_000, none)).toBeNull();
  expect(none).toHaveBeenCalledTimes(1);
});

test("the same question asked twice at once is answered once", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const fn = vi.fn(async () => { await gate; return "x"; });
  const both = Promise.all([cached("test:d", 60_000, fn), cached("test:d", 60_000, fn)]);
  release();
  expect(await both).toEqual(["x", "x"]);
  expect(fn).toHaveBeenCalledTimes(1);
});
