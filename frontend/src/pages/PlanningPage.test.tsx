import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({
  listTrips: vi.fn(async () => [{ id: "t1", name: "Italy 2025", status: "planning", startDate: "2025-06-01", endDate: "2025-06-14", color: "#2563eb", description: "" }]),
  listBlackouts: vi.fn(async () => []),
  listSuggestions: vi.fn(async (): Promise<{ items: unknown[] }> => ({ items: [] })),
  applySuggestion: vi.fn(async () => ({ tripId: "t9", attached: 12 })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
// The trip's own detail is tested on its own.
vi.mock("../components/planning/TripDetail", () => ({ TripDetail: ({ trip }: { trip: { name: string } }) => <div role="dialog" aria-label={trip.name} /> }));
import { PlanningPage } from "./PlanningPage";

test("renders the board and toggles to the timeline", async () => {
  render(withQC(<MemoryRouter><PlanningPage /></MemoryRouter>));
  expect(await screen.findByText("Italy 2025")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Timeline/ }));
  // Still shows the trip (now as a bar) after toggling:
  expect(screen.getByText(/Italy 2025/)).toBeInTheDocument();
});

test("a trip found in the photos: Create trip makes it and opens it", async () => {
  const lisbon = { id: "t9", name: "Lisbon, March 2019", status: "done", startDate: "2019-03-03", endDate: "2019-03-07", color: "#2563eb", description: "" };
  h.listSuggestions.mockResolvedValue({ items: [{ key: "new-trip:2019-03-03:2019-03-07:39.3,-9.0", kind: "new-trip", count: 12, thumbUrls: [], label: "Lisbon", startDate: "2019-03-03", endDate: "2019-03-07", name: "Lisbon, March 2019" }] });
  render(withQC(<MemoryRouter><PlanningPage /></MemoryRouter>));
  expect(await screen.findByRole("region", { name: "Trips in your photos" })).toBeInTheDocument();
  h.listTrips.mockResolvedValue([lisbon] as never);
  fireEvent.click(screen.getByRole("button", { name: "Create trip" }));
  expect(await screen.findByRole("dialog", { name: "Lisbon, March 2019" })).toBeInTheDocument();
  await waitFor(() => expect(h.applySuggestion).toHaveBeenCalledWith("new-trip:2019-03-03:2019-03-07:39.3,-9.0", "Lisbon, March 2019"));
});
