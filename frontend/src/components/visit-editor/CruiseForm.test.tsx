import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
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
