import { expect, test } from "vitest";
import { toFeatureCollection } from "./PhotoMap";

test("turns the compact map points into GeoJSON the map can cluster", () => {
  const fc = toFeatureCollection([["a", 12.5, 41.9, "image"], ["b", -9.2, 38.7, "video"]]);
  expect(fc.features).toHaveLength(2);
  expect(fc.features[0]).toEqual({ type: "Feature", geometry: { type: "Point", coordinates: [12.5, 41.9] }, properties: { id: "a", kind: "image" } });
  expect(fc.features[1].properties.kind).toBe("video");
});
