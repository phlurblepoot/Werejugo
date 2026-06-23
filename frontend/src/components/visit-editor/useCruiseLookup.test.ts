import { expect, test } from "vitest";
import { shiftIso, closestSailing } from "./useCruiseLookup";

test("shiftIso moves a datetime by an offset", () => {
  expect(shiftIso("2024-06-01T00:00:00.000Z", 24 * 3600 * 1000)).toBe("2024-06-02T00:00:00.000Z");
  expect(shiftIso(null, 1000)).toBeNull();
  expect(shiftIso("2024-06-01T00:00:00.000Z", 0)).toBe("2024-06-01T00:00:00.000Z");
});

test("closestSailing picks the dated sailing nearest a target date", () => {
  const sailings = [
    { id: "a", dateISO: "2024-01-01", dateText: "", title: "", departurePort: "", price: "" },
    { id: "b", dateISO: "2024-06-15", dateText: "", title: "", departurePort: "", price: "" },
    { id: "c", dateISO: null, dateText: "", title: "", departurePort: "", price: "" },
  ];
  expect(closestSailing(sailings, "2024-06-10")?.id).toBe("b");
  expect(closestSailing(sailings, "")).toBeNull();
  expect(closestSailing([], "2024-06-10")).toBeNull();
});
