import { expect, test } from "vitest";
import { MODULES } from "./modules";

test("Photos is enabled", () => {
  expect(MODULES.find((m) => m.key === "photos")?.enabled).toBe(true);
});
