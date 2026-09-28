import { expect, test } from "vitest";
import { buildRoutePath, greatCirclePath, unwrapLngs } from "./geo";

test("a flight across the Pacific is one continuous line, not a jump across the map", () => {
  const path = greatCirclePath([[139.77, 35.55], [-122.38, 37.62]]); // Tokyo → San Francisco
  for (let i = 1; i < path.length; i++) expect(Math.abs(path[i][0] - path[i - 1][0])).toBeLessThan(10);
  expect(path[0][0]).toBeCloseTo(139.77, 5);
  expect(path[path.length - 1][0]).toBeCloseTo(-122.38 + 360, 5);
  expect(unwrapLngs([[179, 0], [-179, 0], [-178, 1]])).toEqual([[179, 0], [181, 0], [182, 1]]);
});

test("drives join their stops directly (until roads are known); flights curve", () => {
  expect(buildRoutePath("drive", [[0, 0], [1, 1]])).toEqual([[0, 0], [1, 1]]);
  expect(buildRoutePath("flight", [[0, 0], [10, 10]]).length).toBe(49);
});

test("the bounds of what's on the map: points, lines and stops", async () => {
  const { boundsOf } = await import("./geo");
  const items = [
    { geometry: { type: "Point", coordinates: [12.5, 41.9] }, waypoints: [] },
    { geometry: { type: "LineString", coordinates: [[-80, 25], [-86, 20]] }, waypoints: [{ lng: -87.7, lat: 18.7 }] },
    { geometry: null, waypoints: [] },
  ] as never;
  expect(boundsOf(items)).toEqual([[-87.7, 18.7], [12.5, 41.9]]);
  expect(boundsOf([] as never)).toBeNull();
});
