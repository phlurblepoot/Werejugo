import { expect, test } from "vitest";
import { isAllowedPair } from "./links.js";

test("allows visit-media in either order", () => {
  expect(isAllowedPair("visit", "media")).toBe(true);
  expect(isAllowedPair("media", "visit")).toBe(true);
});

test("allows trip-person and person-media", () => {
  expect(isAllowedPair("trip", "person")).toBe(true);
  expect(isAllowedPair("person", "media")).toBe(true);
});

test("disallows media-trip (that is the media.trip_id FK, not a link)", () => {
  expect(isAllowedPair("media", "trip")).toBe(false);
});

test("disallows nonsense pairs", () => {
  expect(isAllowedPair("document", "document")).toBe(false);
});
