import { expect, test } from "vitest";
import { parseRef, CORE_TYPES } from "./refs.js";

test("parses a valid ref", () => {
  expect(parseRef("visit:11111111-1111-1111-1111-111111111111")).toEqual({
    type: "visit",
    id: "11111111-1111-1111-1111-111111111111",
  });
});

test("rejects unknown type", () => {
  expect(parseRef("dragon:11111111-1111-1111-1111-111111111111")).toBeNull();
});

test("rejects malformed id", () => {
  expect(parseRef("visit:not-a-uuid")).toBeNull();
});

test("exposes the core type list", () => {
  expect(CORE_TYPES).toContain("media");
});
