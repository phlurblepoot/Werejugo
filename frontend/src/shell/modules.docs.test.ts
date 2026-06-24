import { expect, test } from "vitest";
import { MODULES } from "./modules";

test("Documents is enabled", () => {
  expect(MODULES.find((m) => m.key === "documents")?.enabled).toBe(true);
});
