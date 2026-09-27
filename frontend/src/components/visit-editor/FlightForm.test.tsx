import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({ lookupFlight: vi.fn(), searchAirports: vi.fn() }));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { FlightForm } from "./FlightForm";
import type { VisitDraft } from "./useVisitDraft";

const draft = (patch: Partial<VisitDraft> = {}) => ({ kind: "flight", title: "", stops: [], occurredOn: "", routePath: [[0, 0], [1, 1]], ...patch }) as unknown as VisitDraft;
beforeEach(() => vi.clearAllMocks());

test("airports are picked as you type, in order; picking one clears the old line", async () => {
  h.searchAirports.mockResolvedValue([{ label: "LHR — London", lng: -0.46, lat: 51.47, source: "airport" }]);
  const set = vi.fn();
  render(<FlightForm draft={draft()} set={set} />);
  await userEvent.type(screen.getByPlaceholderText("Add a stop…"), "lhr");
  await userEvent.click(await screen.findByText("LHR — London"));
  expect(h.searchAirports).toHaveBeenCalledWith("lhr");
  expect(set).toHaveBeenCalledWith(expect.objectContaining({ routePath: null, route: null, stops: [expect.objectContaining({ label: "LHR — London" })] }));
});

test("a flight number and its day: every leg with its times, the item's date, a new line", async () => {
  h.lookupFlight.mockResolvedValue({
    title: "Southwest WN1234 (MDW → DEN → PHX)", date: "2026-10-01", path: [], warnings: [],
    waypoints: [
      { label: "Chicago (MDW)", kind: "origin", lng: -87.75, lat: 41.79, departAt: "2026-10-01T09:05:00.000Z" },
      { label: "Denver (DEN)", kind: "stop", lng: -104.67, lat: 39.86, arriveAt: "2026-10-01T10:40:00.000Z", departAt: "2026-10-01T12:40:00.000Z" },
      { label: "Phoenix (PHX)", kind: "destination", lng: -112.01, lat: 33.43, arriveAt: "2026-10-01T13:55:00.000Z" },
    ],
  });
  const set = vi.fn();
  render(<FlightForm draft={draft()} set={set} />);
  await userEvent.click(screen.getByRole("button", { name: "Flight number" }));
  await userEvent.type(screen.getByLabelText("Flight number"), "wn1234");
  await userEvent.type(screen.getByLabelText("The day it left"), "2026-10-01");
  await userEvent.click(screen.getByRole("button", { name: "Look up" }));
  await waitFor(() => expect(h.lookupFlight).toHaveBeenCalledWith({ flightNumber: "WN1234", date: "2026-10-01" }));
  const filled = set.mock.calls.map((c) => c[0]).find((p) => p.stops);
  expect(filled).toMatchObject({ routePath: null, route: null, occurredOn: "2026-10-01", title: "Southwest WN1234 (MDW → DEN → PHX)" });
  expect(filled.stops.map((s: { label: string; arriveAt: string | null; departAt: string | null }) => [s.label, s.arriveAt, s.departAt])).toEqual([
    ["Chicago (MDW)", null, "2026-10-01T09:05:00.000Z"],
    ["Denver (DEN)", "2026-10-01T10:40:00.000Z", "2026-10-01T12:40:00.000Z"],
    ["Phoenix (PHX)", "2026-10-01T13:55:00.000Z", null],
  ]);
});

test("a flight it can't find says why and changes nothing", async () => {
  h.lookupFlight.mockResolvedValue({ title: "", waypoints: [], path: [], warnings: ["No flight ZZ999 found on 2026-10-01."] });
  const set = vi.fn();
  render(<FlightForm draft={draft({ occurredOn: "2026-10-01" })} set={set} />);
  await userEvent.click(screen.getByRole("button", { name: "Flight number" }));
  await userEvent.type(screen.getByLabelText("Flight number"), "ZZ999");
  await userEvent.click(screen.getByRole("button", { name: "Look up" }));
  expect(await screen.findByText(/No flight ZZ999 found/)).toBeInTheDocument();
  expect(set).not.toHaveBeenCalled();
});
