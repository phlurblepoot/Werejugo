import { expect, test } from "vitest";
import { formatVersion, isSupported, SUPPORTED_RANGE } from "./version.js";

const v = (major: number, minor: number, patch: number) => ({ major, minor, patch });

test("Immich 3.2 up to (not including) 4.0 is supported", () => {
  expect(isSupported(v(3, 2, 0))).toBe(true);
  expect(isSupported(v(3, 2, 2))).toBe(true);
  expect(isSupported(v(3, 9, 14))).toBe(true);
  expect(isSupported(v(3, 1, 9))).toBe(false);
  expect(isSupported(v(2, 7, 0))).toBe(false);
  expect(isSupported(v(4, 0, 0))).toBe(false);
});

test("versions print like Immich writes them", () => {
  expect(formatVersion(v(3, 2, 2))).toBe("3.2.2");
  expect(formatVersion({ ...v(3, 3, 0), prerelease: "rc.1" })).toBe("3.3.0-rc.1");
  expect(SUPPORTED_RANGE).toBe("3.2 or newer, before 4.0");
});
