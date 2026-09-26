import { expect, test } from "vitest";
import type { Item } from "../api/client";
import { activeFilterCount, applyFilters, readFilters, writeFilters, yearsOf } from "./mapFilters";

const item = (over: Partial<Item>): Item => ({
  id: "x", kind: "place", title: "", notes: "", themeId: null, tripId: null, color: null, icon: null,
  occurredOn: null, geometry: null, waypoints: [], photos: [], createdBy: null, createdByName: null, ...over,
}) as Item;

const items = [
  item({ id: "a", title: "Colosseum", kind: "place", tripId: "t1", occurredOn: "2024-06-02", personIds: ["p1"], familyId: "me" }),
  item({ id: "b", title: "Pizza", kind: "food", occurredOn: "2023-03-10", familyId: "me" }),
  item({ id: "c", title: "Their beach", kind: "place", tripId: "t2", occurredOn: "2025-07-12", familyId: "them", familyName: "The Smiths" }),
];

test("filters come from and go back to the URL, keeping other params", () => {
  const f = readFilters(new URLSearchParams("trip=t1&kind=food,flight,bogus&year=2024&family=others&visit=v9&year2=x"));
  expect(f).toEqual({ q: "", kinds: ["food", "flight"], trip: "t1", person: "", year: "2024", family: "others" });
  const next = writeFilters(new URLSearchParams("visit=v9&trip=t1"), { trip: "", kinds: ["cruise"], person: "p1" });
  expect(next.toString()).toBe("visit=v9&kind=cruise&person=p1");
  expect(readFilters(new URLSearchParams("year=24&family=everyone")).year).toBe("");
});

test("each filter narrows the places", () => {
  const ids = (q: string) => applyFilters(items, readFilters(new URLSearchParams(q)), "me").map((i) => i.id);
  expect(ids("")).toEqual(["a", "b", "c"]);
  expect(ids("q=pizz")).toEqual(["b"]);
  expect(ids("kind=place")).toEqual(["a", "c"]);
  expect(ids("trip=t1")).toEqual(["a"]);
  expect(ids("trip=none")).toEqual(["b"]);
  expect(ids("person=p1")).toEqual(["a"]);
  expect(ids("year=2023")).toEqual(["b"]);
  expect(ids("family=mine")).toEqual(["a", "b"]);
  expect(ids("family=others")).toEqual(["c"]);
});

test("helpers", () => {
  expect(yearsOf(items)).toEqual(["2025", "2024", "2023"]);
  expect(activeFilterCount(readFilters(new URLSearchParams("kind=food&year=2024")))).toBe(2);
});
