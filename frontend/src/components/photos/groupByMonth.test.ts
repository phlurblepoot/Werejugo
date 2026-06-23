import { expect, test } from "vitest";
import { groupByMonth } from "./groupByMonth";

test("groups items by capture month, newest first, with labels", () => {
  const items = [
    { id: "a", takenAt: "2024-06-10T10:00:00Z", createdAt: "2024-09-01T00:00:00Z" },
    { id: "b", takenAt: "2024-03-05T10:00:00Z", createdAt: "2024-09-01T00:00:00Z" },
    { id: "c", takenAt: null, createdAt: "2024-06-20T00:00:00Z" },
  ];
  const groups = groupByMonth(items, (i) => i.takenAt ?? i.createdAt);
  expect(groups.map((g) => g.key)).toEqual(["2024-06", "2024-03"]);
  expect(groups[0].label).toMatch(/June 2024/);
  expect(groups[0].items.map((i) => i.id)).toEqual(["a", "c"]);
});
