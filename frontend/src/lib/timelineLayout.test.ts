import { expect, test } from "vitest";
import { layoutTimeline, monthLabel, monthsInRows } from "./timelineLayout";

const months = [
  { month: "2025-07", count: 7 },
  { month: "2025-01", count: 3 },
  { month: "2024-12", count: 1 },
  { month: "2019-03", count: 0 },
];

test("rows come from month counts and the width: a header, then rows of photos", () => {
  // 4 columns: (628 + 4) / (154) = 4.1
  const l = layoutTimeline(months, 628, { target: 150, gap: 4, header: 40 });
  expect(l.columns).toBe(4);
  expect(l.cell).toBeCloseTo((628 - 12) / 4);
  expect(l.rows.map((r) => (r.kind === "header" ? r.month : `${r.month}+${r.start}x${r.count}`))).toEqual([
    "2025-07", "2025-07+0x4", "2025-07+4x3",
    "2025-01", "2025-01+0x3",
    "2024-12", "2024-12+0x1",
  ]);
  // Tops add up, and the total is the sum of heights.
  const row = l.cell + 4;
  expect(l.rows[2].top).toBeCloseTo(40 + row);
  expect(l.height).toBeCloseTo(3 * 40 + 4 * row);
  expect(l.monthRow.get("2024-12")).toBe(5);
});

test("years point at their newest month, for jumping", () => {
  const l = layoutTimeline(months, 400);
  expect(l.years).toEqual([{ year: "2025", month: "2025-07" }, { year: "2024", month: "2024-12" }]);
});

test("a phone still gets three columns", () => {
  expect(layoutTimeline(months, 300).columns).toBe(3);
});

test("the months to fetch are those with rows on screen", () => {
  const l = layoutTimeline(months, 628, { target: 150 });
  expect(monthsInRows(l, 1, 3)).toEqual(["2025-07", "2025-01"]);
  expect(monthsInRows(l, 5, 99)).toEqual(["2024-12"]);
});

test("month labels read naturally", () => {
  expect(monthLabel("2025-07")).toBe("July 2025");
});
