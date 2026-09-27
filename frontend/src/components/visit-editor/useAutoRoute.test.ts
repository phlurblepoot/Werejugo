import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  routeRoad: vi.fn(async (points: number[][]) => ({ source: "road", path: [points[0], [0.5, 0.7], points[1]], distanceM: 150_000 })),
  routeSea: vi.fn(async (points: number[][]) => ({ source: "sea", path: [points[0], [2, -1], points[1]], distanceM: 400_000 })),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { useAutoRoute } from "./useAutoRoute";
import type { VisitDraft } from "./useVisitDraft";

const stop = (lng: number, lat: number) => ({ label: `${lng}`, kind: "stop" as const, lng, lat, seq: 0 });
const draft = (patch: Partial<VisitDraft>): VisitDraft => ({
  kind: "drive", title: "", notes: "", occurredOn: "", themeId: null, tripId: null, color: "", icon: "",
  pin: {} as VisitDraft["pin"], path: {} as VisitDraft["path"], point: null, stops: [], routePath: null, route: null,
  cruiseLine: "", ship: "", baseProperties: {}, ...patch,
});

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());

test("a drive's stops are routed along roads once they stop changing", async () => {
  const set = vi.fn();
  const { result, rerender } = renderHook(({ d }) => useAutoRoute(d, set), { initialProps: { d: draft({ stops: [stop(0, 0), stop(1, 1)] }) } });
  expect(result.current.routing).toBe(true);
  rerender({ d: draft({ stops: [stop(0, 0), stop(1, 2)] }) });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(h.routeRoad).toHaveBeenCalledTimes(1);
  expect(h.routeRoad).toHaveBeenCalledWith([[0, 0], [1, 2]]);
  expect(set).toHaveBeenCalledWith({ routePath: [[0, 0], [0.5, 0.7], [1, 2]], route: { source: "road", distanceM: 150_000 } });
  expect(result.current.routing).toBe(false);
});

test("no road route: the stops are joined directly, and the editor says why", async () => {
  h.routeRoad.mockRejectedValueOnce(new Error("No road route between these stops."));
  const set = vi.fn();
  const { result } = renderHook(() => useAutoRoute(draft({ stops: [stop(0, 0), stop(1, 1)] }), set));
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(set).toHaveBeenCalledWith({ routePath: [[0, 0], [1, 1]], route: { source: "straight", distanceM: expect.any(Number) } });
  expect(result.current.note).toBe("No road route between these stops. The stops are joined directly for now.");
});

test("a cruise's ports are routed across water; a line it already has (from CruiseMapper) is kept", async () => {
  const set = vi.fn();
  renderHook(() => useAutoRoute(draft({ kind: "cruise", stops: [stop(0, 0), stop(3, 0)], routePath: [[0, 0], [3, 0]] }), set));
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(h.routeSea).not.toHaveBeenCalled();

  renderHook(() => useAutoRoute(draft({ kind: "cruise", stops: [stop(0, 0), stop(3, 0)] }), set));
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(set).toHaveBeenCalledWith({ routePath: [[0, 0], [2, -1], [3, 0]], route: { source: "sea", distanceM: 400_000 } });
});

test("places and flights aren't routed here", async () => {
  const set = vi.fn();
  renderHook(() => useAutoRoute(draft({ kind: "flight", stops: [stop(0, 0), stop(3, 0)] }), set));
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(set).not.toHaveBeenCalled();
});
