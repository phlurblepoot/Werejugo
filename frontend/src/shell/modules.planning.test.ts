import { expect, test } from "vitest";
import { MODULES } from "./modules";

test("Planning is enabled", () => {
  expect(MODULES.find((m) => m.key === "planning")?.enabled).toBe(true);
});
