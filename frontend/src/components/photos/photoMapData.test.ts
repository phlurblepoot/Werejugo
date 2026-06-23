import { expect, test } from "vitest";
import { toFeatureCollection } from "./PhotoMap";

test("builds a FeatureCollection from geotagged photos only", () => {
  const items = [
    { id: "a", lng: 12.5, lat: 41.9, thumbUrl: "/t/a" },
    { id: "b", lng: null, lat: null, thumbUrl: null },
  ] as any;
  const fc = toFeatureCollection(items);
  expect(fc.features).toHaveLength(1);
  expect(fc.features[0].geometry.coordinates).toEqual([12.5, 41.9]);
  expect(fc.features[0].properties.id).toBe("a");
});
