import { renderHook, act } from "@testing-library/react";
import { expect, test } from "vitest";
import { useVisitDraft } from "./useVisitDraft";

test("buildPayload makes a Point for a place kind", () => {
  const { result } = renderHook(() => useVisitDraft(null));
  act(() => { result.current.setKind("food"); });
  act(() => { result.current.set({ title: "Joe's Pizza", point: [-74, 40.7], occurredOn: "2024-05-01" }); });
  const p = result.current.buildPayload();
  expect(p.kind).toBe("food");
  expect(p.title).toBe("Joe's Pizza");
  expect(p.geometry).toEqual({ type: "Point", coordinates: [-74, 40.7] });
  expect(p.waypoints).toEqual([]);
  expect(p.occurredOn).toBe("2024-05-01");
  expect((p.properties as any).pin).toBeDefined();
  expect((p.properties as any).path).toBeUndefined();
});

test("buildPayload makes a LineString for a drive from stops", () => {
  const { result } = renderHook(() => useVisitDraft(null));
  act(() => { result.current.setKind("drive"); });
  act(() => {
    result.current.set({
      title: "Road trip",
      stops: [
        { label: "A", kind: "origin", lng: 0, lat: 0, seq: 0 },
        { label: "B", kind: "destination", lng: 1, lat: 1, seq: 1 },
      ],
    });
  });
  const p = result.current.buildPayload();
  expect(p.geometry).toEqual({ type: "LineString", coordinates: [[0, 0], [1, 1]] });
  expect(p.waypoints).toHaveLength(2);
  expect((p.properties as any).path).toBeDefined();
});

test("validate flags missing title, then missing location", () => {
  const { result } = renderHook(() => useVisitDraft(null));
  expect(result.current.validate()).toEqual({ field: "title", message: expect.stringMatching(/title/i) });
  act(() => { result.current.set({ title: "X" }); });            // place kind, no point
  expect(result.current.validate()).toEqual({ field: "location", message: expect.stringMatching(/location|place/i) });
  act(() => { result.current.set({ point: [1, 2] }); });
  expect(result.current.validate()).toBeNull();
});

test("setKind refreshes color/icon defaults when no theme is set", () => {
  const { result } = renderHook(() => useVisitDraft(null));
  act(() => { result.current.setKind("food"); });
  expect(result.current.draft.color).toBe("#ea580c"); // KIND_DEFAULTS.food
});
