import { expect, test } from "vitest";
import { MODULES } from "./modules";

test("Packing is enabled", () => {
  expect(MODULES.find((m) => m.key === "packing")?.enabled).toBe(true);
});
