import { expect, test } from "vitest";
import { slugify, tripSlug, mediaDirFor, documentDirFor } from "./storage.js";

test("slugify lowercases and kebab-cases", () => {
  expect(slugify("Joe's Pizza & Pasta!")).toBe("joes-pizza-pasta");
});

test("tripSlug prefixes the start year when present", () => {
  expect(tripSlug("Italy Adventure", "2024-06-01")).toBe("2024-italy-adventure");
  expect(tripSlug("Italy Adventure", null)).toBe("italy-adventure");
});

test("mediaDirFor uses the trip folder when a trip is given", () => {
  expect(mediaDirFor({ name: "Italy", startDate: "2024-06-01" }, new Date("2024-06-10"))).toBe(
    "trips/2024-italy/photos",
  );
});

test("mediaDirFor falls back to loose/<year> with no trip", () => {
  expect(mediaDirFor(null, new Date("2023-03-04"))).toBe("loose/2023");
});

test("mediaDirFor uses 'unknown' year when no date", () => {
  expect(mediaDirFor(null, null)).toBe("loose/unknown");
});

test("documentDirFor routes by owner", () => {
  expect(documentDirFor({ tripName: "Italy", tripStart: "2024-06-01" }, null)).toBe(
    "trips/2024-italy/documents",
  );
  expect(documentDirFor(null, { personName: "Dad" })).toBe("people/dad");
  expect(documentDirFor(null, null)).toBe("loose/documents");
});
