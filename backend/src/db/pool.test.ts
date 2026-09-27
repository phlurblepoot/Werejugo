import { expect, test, vi } from "vitest";
import { pool } from "./pool.js";

test("a lost idle connection is logged, not fatal", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  // With no listener, EventEmitter throws on "error" — which crashes the server.
  expect(() => pool.emit("error", new Error("terminating connection due to administrator command"), {} as never)).not.toThrow();
  expect(spy).toHaveBeenCalledWith(expect.stringContaining("idle connection lost"));
  spy.mockRestore();
});
