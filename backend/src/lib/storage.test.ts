import { expect, test } from "vitest";
import { slugify, tripSlug, mediaDirFor, documentDirFor } from "./storage.js";

test("slugify lowercases and kebab-cases", () => {
  expect(slugify("Joe's Pizza & Pasta!")).toBe("joes-pizza-pasta");
});

test("tripSlug prefixes the start year when present", () => {
  expect(tripSlug("Italy Adventure", "2024-06-01")).toBe("2024-italy-adventure");
  expect(tripSlug("Italy Adventure", null)).toBe("italy-adventure");
});

const F = "f1111111-1111-4111-8111-111111111111";

test("every path is inside the family's own folder", () => {
  expect(mediaDirFor(F, { name: "Italy", startDate: "2024-06-01" }, new Date("2024-06-10"))).toBe(`families/${F}/trips/2024-italy/photos`);
  expect(mediaDirFor(F, null, new Date("2023-03-04"))).toBe(`families/${F}/loose/2023`);
  expect(mediaDirFor(F, null, null)).toBe(`families/${F}/loose/unknown`);
});

test("documentDirFor routes by owner", () => {
  expect(documentDirFor(F, { tripName: "Italy", tripStart: "2024-06-01" }, null)).toBe(`families/${F}/trips/2024-italy/documents`);
  expect(documentDirFor(F, null, { personName: "Dad" })).toBe(`families/${F}/people/dad`);
  expect(documentDirFor(F, null, null)).toBe(`families/${F}/loose/documents`);
});
