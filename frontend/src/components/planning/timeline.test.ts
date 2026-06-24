import { expect, test } from "vitest";
import { placeOnAxis, axisBounds } from "./timeline";

test("placeOnAxis returns left/width percentages within the axis", () => {
  const r = placeOnAxis("2025-01-01", "2025-01-11", "2025-01-03", "2025-01-05");
  expect(r.left).toBeCloseTo(20, 1);
  expect(r.width).toBeCloseTo(20, 1);
});

test("placeOnAxis clamps a bar starting before the axis", () => {
  const r = placeOnAxis("2025-01-01", "2025-01-11", "2024-12-20", "2025-01-02");
  expect(r.left).toBe(0);
});

test("axisBounds spans the min start to the max end across items", () => {
  const b = axisBounds([
    { startDate: "2025-03-01", endDate: "2025-03-10" },
    { startDate: "2025-08-01", endDate: "2025-08-20" },
  ]);
  expect(b.start).toBe("2025-03-01");
  expect(b.end).toBe("2025-08-20");
});
