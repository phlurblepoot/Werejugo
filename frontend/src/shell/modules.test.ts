import { expect, test } from "vitest";
import { MODULES } from "./modules";

test("every module is registered once, with a route and an icon", () => {
  expect(MODULES.map((m) => m.key)).toEqual(["map", "people", "photos", "documents", "planning", "packing"]);
  for (const m of MODULES) {
    expect(m.path).toBe(`/${m.key}`);
    expect(m.icon).toBeTruthy();
    expect(m.short.length).toBeLessThanOrEqual(7); // fits the phone tab bar
  }
});

test("the phone tab bar holds four modules (plus More)", () => {
  expect(MODULES.filter((m) => m.tab).map((m) => m.key)).toEqual(["map", "photos", "documents", "planning"]);
});
