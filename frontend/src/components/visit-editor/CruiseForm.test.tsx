import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
const h = vi.hoisted(() => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  return {
    ApiError,
    api: {
      searchCruiseLines: vi.fn(async () => []),
      searchCruiseShips: vi.fn(async () => []),
      searchPorts: vi.fn(async () => []),
      findCruise: vi.fn(),
      getSailingDetail: vi.fn(),
      matchCruise: vi.fn(),
      cruiseFromPhotos: vi.fn(),
    },
  };
});
vi.mock("../../api/client", () => ({ API_URL: "", api: h.api }));
import { CruiseForm } from "./CruiseForm";
import type { VisitDraft } from "./useVisitDraft";

const draft = (patch: Partial<VisitDraft> = {}) =>
  ({ kind: "cruise", cruiseLine: "Royal Caribbean", ship: "Symphony of the Seas", stops: [], occurredOn: "2026-11-07", title: "", ...patch }) as unknown as VisitDraft;
const FOUND = {
  shipName: "Symphony of the Seas", shipUrl: "https://www.cruisemapper.com/ships/Symphony-of-the-Seas-1185",
  image: "https://www.cruisemapper.com/images/ships/1185.jpg", lineName: "Royal Caribbean", lineLogo: null, warnings: [], ports: [],
  sailings: [{ id: "9001", dateISO: "2026-11-07", dateText: "7 Nov 2026", title: "7 Night Eastern Caribbean", departurePort: "Miami", price: "" }],
};
const DETAIL = {
  ports: [
    { label: "Miami", kind: "origin", lng: -80.18, lat: 25.77, dateISO: "2026-11-07", arriveAt: null, departAt: "2026-11-07T16:30:00.000Z" },
    { label: "Labadee", kind: "destination", lng: -72.25, lat: 19.78, dateISO: "2026-11-09", arriveAt: "2026-11-09T08:00:00.000Z", departAt: null },
  ],
  path: [[-80.18, 25.77], [-76, 22], [-72.25, 19.78]],
  warnings: [],
};
beforeEach(() => vi.clearAllMocks());

test("renders the CruiseMapper finder and a stops builder", () => {
  render(<CruiseForm draft={draft()} set={() => {}} />);
  expect(screen.getByText(/Find on CruiseMapper/)).toBeInTheDocument();
  expect(screen.getByText(/Ports of call/)).toBeInTheDocument();
});

test("the sailing on the cruise's date fills in its ports and track, and the cruise's details are kept", async () => {
  h.api.findCruise.mockResolvedValue(FOUND);
  h.api.getSailingDetail.mockResolvedValue(DETAIL);
  const set = vi.fn();
  render(<CruiseForm draft={draft()} set={set} />);
  await userEvent.click(screen.getByRole("button", { name: /Find on CruiseMapper/ }));
  await waitFor(() => expect(h.api.getSailingDetail).toHaveBeenCalledWith("9001", "2026-11-07"));
  const filled = set.mock.calls.map((c) => c[0]).find((p) => p.stops);
  expect(filled.routePath).toEqual(DETAIL.path);
  expect(filled.route).toEqual({ source: "cruisemapper", distanceM: expect.any(Number) });
  expect(filled.cruise).toEqual({
    line: "Royal Caribbean", ship: "Symphony of the Seas", shipUrl: FOUND.shipUrl, shipImage: FOUND.image, lineLogo: null,
    sailingId: "9001", sailingTitle: "7 Night Eastern Caribbean", sailingDate: "2026-11-07", matchedBy: "date", shiftDays: 0,
  });
  expect(filled.stops.map((s: { label: string }) => s.label)).toEqual(["Miami", "Labadee"]);
});

test("CruiseMapper not answering: it says so, and Try again asks again", async () => {
  h.api.findCruise.mockRejectedValueOnce(new h.ApiError(503, "CruiseMapper isn't answering right now. Try again in a few minutes, or add the ports yourself."));
  h.api.findCruise.mockResolvedValueOnce({ ...FOUND, sailings: [] });
  render(<CruiseForm draft={draft()} set={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /Find on CruiseMapper/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("CruiseMapper isn't answering right now.");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(h.api.findCruise).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

test("turned off on the server: it says so, with nothing to retry", async () => {
  h.api.findCruise.mockRejectedValueOnce(new h.ApiError(409, "Cruise lookup is turned off on this server. Add the ports yourself."));
  render(<CruiseForm draft={draft()} set={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /Find on CruiseMapper/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("turned off");
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

describe("a past cruise", () => {
  const MATCH = {
    sailing: { id: "9101", title: "7 Night Western Caribbean", dateISO: "2027-03-14", ship: "Wonder of the Seas", shipUrl: "u" },
    ports: [
      { label: "Miami", kind: "origin", lng: -80.18, lat: 25.77, dateISO: "2027-03-14", arriveAt: null, departAt: "2027-03-14T16:30:00.000Z" },
      { label: "Cozumel", kind: "port", lng: -86.95, lat: 20.51, dateISO: "2027-03-17", arriveAt: "2027-03-17T07:00:00.000Z", departAt: "2027-03-17T17:00:00.000Z" },
      { label: "Miami", kind: "destination", lng: -80.18, lat: 25.77, dateISO: "2027-03-21", arriveAt: "2027-03-21T06:00:00.000Z", departAt: null },
    ],
    path: [[-80.18, 25.77], [-84, 23], [-86.95, 20.51], [-80.18, 25.77]],
    score: 1,
    shiftDays: -728,
  };
  const stops = [
    { label: "Miami", kind: "origin" as const, lng: -80.18, lat: 25.77, seq: 0 },
    { label: "Cozumel", kind: "destination" as const, lng: -86.95, lat: 20.51, seq: 1 },
  ];

  test("says CruiseMapper only lists sailings from now on, and finds the same itinerary moved to its dates", async () => {
    h.api.matchCruise.mockResolvedValue({ matches: [MATCH], warnings: [] });
    const set = vi.fn();
    render(<CruiseForm draft={draft({ occurredOn: "2025-03-16", occurredEnd: "2025-03-23", stops })} set={set} />);
    expect(screen.getByRole("region", { name: "A past cruise" })).toHaveTextContent("only lists sailings from now on");
    await userEvent.click(screen.getByRole("button", { name: "Find the same itinerary" }));
    expect(h.api.matchCruise).toHaveBeenCalledWith(expect.objectContaining({
      ship: "Symphony of the Seas", line: "Royal Caribbean", date: "2025-03-16", nights: 7,
      ports: [{ name: "Miami", lng: -80.18, lat: 25.77 }, { name: "Cozumel", lng: -86.95, lat: 20.51 }],
    }));
    await userEvent.click(await screen.findByRole("button", { name: /Wonder of the Seas · 7 Night Western Caribbean\s*Same ports/ }));
    const applied = set.mock.calls.map((c) => c[0]).find((p) => p.stops);
    expect(applied.stops.map((s: { label: string; arriveAt: string | null; departAt: string | null }) => [s.label, s.arriveAt, s.departAt])).toEqual([
      ["Miami", null, "2025-03-16T16:30:00.000Z"],
      ["Cozumel", "2025-03-19T07:00:00.000Z", "2025-03-19T17:00:00.000Z"],
      ["Miami", "2025-03-23T06:00:00.000Z", null],
    ]);
    expect(applied.routePath).toEqual(MATCH.path);
    expect(applied.cruise).toMatchObject({ matchedBy: "itinerary", shiftDays: -728, sailingId: "9101", ship: "Symphony of the Seas" });
  });

  test("Build from ports: each port added gets the next day", async () => {
    h.api.searchPorts.mockResolvedValue([{ label: "Nassau, Bahamas", lng: -77.34, lat: 25.08, source: "port" }] as never);
    const set = vi.fn();
    render(<CruiseForm draft={draft({ occurredOn: "2025-03-16", stops: [stops[0]] })} set={set} />);
    await userEvent.click(screen.getByRole("button", { name: "Build from ports" }));
    expect(document.activeElement?.id).toBe("cruise-port-search");
    await userEvent.type(document.activeElement as HTMLElement, "nass");
    await userEvent.click(await screen.findByText("Nassau, Bahamas"));
    const added = set.mock.calls.map((c) => c[0]).find((p) => p.stops);
    expect(added.stops[1]).toMatchObject({ label: "Nassau, Bahamas", arriveAt: "2025-03-17T00:00:00.000Z" });
    expect(added.routePath).toBeNull();
  });
});

test("a past cruise from my photos of its days", async () => {
  h.api.cruiseFromPhotos.mockResolvedValue({
    ports: [
      { label: "Miami", kind: "origin", lng: -80.18, lat: 25.77, arriveAt: null, departAt: "2023-03-03T00:00:00.000Z" },
      { label: "Cozumel", kind: "destination", lng: -86.95, lat: 20.51, arriveAt: "2023-03-05T00:00:00.000Z", departAt: null },
    ],
    path: [[-80.18, 25.77], [-84, 23], [-86.95, 20.51]], distanceM: 900_000, photoIds: ["a", "b", "c"], seaPhotos: 1,
  } as never);
  const set = vi.fn();
  render(<CruiseForm draft={draft({ occurredOn: "2023-03-03", occurredEnd: "2023-03-09" })} set={set} />);
  await userEvent.click(screen.getByRole("button", { name: "Build from my photos" }));
  expect(h.api.cruiseFromPhotos).toHaveBeenCalledWith("2023-03-03", "2023-03-09");
  const built = set.mock.calls.map((c) => c[0]).find((p) => p.stops);
  expect(built).toMatchObject({ routePath: [[-80.18, 25.77], [-84, 23], [-86.95, 20.51]], route: { source: "photos", distanceM: 900_000 } });
  expect(await screen.findByText(/Built from 3 photos \(1 at sea\)/)).toBeInTheDocument();
});
