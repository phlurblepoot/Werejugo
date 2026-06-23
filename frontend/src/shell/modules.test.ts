import { expect, test } from "vitest";
import { MODULES } from "./modules";

test("People is enabled", () => {
  expect(MODULES.find((m) => m.key === "people")?.enabled).toBe(true);
});
