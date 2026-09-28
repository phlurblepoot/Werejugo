import { renderHook, act } from "@testing-library/react";
import { describe, expect, test } from "vitest";
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
  // Nothing chosen: it follows the family's defaults (nothing saved).
  expect((p.properties as any).pin).toBeUndefined();
  expect((p.properties as any).path).toBeUndefined();
  expect(p.color).toBeNull();
  expect(p.icon).toBeNull();
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
  expect((p.properties as any).path).toBeUndefined(); // the default trail
  expect((p.properties as any).route).toEqual({ source: "straight" });
});

describe("the item's own style, and the defaults", () => {
  const settings = {
    pin: { byKind: { food: { color: "#111111" } }, byLine: { "Royal Caribbean": { color: "#003399" } } },
    path: { byKind: { drive: { style: "tire" as const } } },
  };
  const beach = { id: "th1", name: "Beach", kind: "place", icon: "umbrella", color: "#ffaa00", lineColor: "#ffaa00", lineWidth: 3, isBuiltin: false } as never;

  test("only what differs from the defaults is saved", () => {
    const { result } = renderHook(() => useVisitDraft(null, settings.pin, settings.path));
    act(() => { result.current.setKind("food"); });
    expect(result.current.draft.color).toBe("#111111"); // the family's colour for food
    act(() => { result.current.set({ title: "x", point: [0, 0], pin: { ...result.current.draft.pin, size: 40 } }); });
    const p = result.current.buildPayload();
    expect(p.color).toBeNull();
    expect((p.properties as any).pin).toEqual({ size: 40 });
    act(() => { result.current.set({ color: "#ff0000" }); });
    expect(result.current.buildPayload().color).toBe("#ff0000");
  });

  test("another kind: what followed the defaults follows the new kind's; the item's own choices stay", () => {
    const { result } = renderHook(() => useVisitDraft(null, settings.pin, settings.path));
    act(() => { result.current.set({ icon: "star" }); }); // chosen
    act(() => { result.current.setKind("drive"); });
    expect(result.current.draft.color).toBe("#7c3aed"); // the drive default
    expect(result.current.draft.icon).toBe("star");
    expect(result.current.draft.path.style).toBe("tire"); // the family's drive trail
    expect(result.current.draft.path.width).toBe(9); // a pattern's width
  });

  test("a theme or a cruise line gives its look without it being saved on the item", () => {
    const { result } = renderHook(() => useVisitDraft(null, settings.pin, settings.path, [beach]));
    act(() => { result.current.applyTheme("th1"); });
    expect(result.current.draft).toMatchObject({ color: "#ffaa00", icon: "umbrella" });
    act(() => { result.current.set({ title: "x", point: [0, 0] }); });
    expect(result.current.buildPayload()).toMatchObject({ themeId: "th1", color: null, icon: null });

    const cruise = renderHook(() => useVisitDraft(null, settings.pin, settings.path));
    act(() => { cruise.result.current.setKind("cruise"); });
    act(() => { cruise.result.current.set({ cruiseLine: "Royal Caribbean" }); });
    expect(cruise.result.current.draft.color).toBe("#003399");
    expect(cruise.result.current.inherited.color).toBe("#003399");
  });

  test("an item saved before this keeps its own choices, and those equal to the defaults are let go", () => {
    const item = {
      id: "v1", kind: "place", title: "Old", notes: "", themeId: null, tripId: null, color: "#2563eb", icon: "star",
      occurredOn: null, geometry: { type: "Point", coordinates: [0, 0] }, waypoints: [], photos: [],
      properties: { pin: { size: 28, shape: "square" } }, createdBy: null, createdByName: null, createdAt: "",
    } as never;
    const { result } = renderHook(() => useVisitDraft(item));
    const p = result.current.buildPayload();
    expect(p).toMatchObject({ color: null, icon: "star" });
    expect((p.properties as any).pin).toEqual({ shape: "square" });
  });
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
