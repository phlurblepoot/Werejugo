import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const h = vi.hoisted(() => ({
  listItinerary: vi.fn(async () => [
    { id: "i1", tripId: "t1", title: "Colosseum", notes: "", scheduledOn: "2025-06-04", seq: 0, lat: null, lng: null, placeLabel: "", convertedVisitId: null, createdAt: "" },
    { id: "i2", tripId: "t1", title: "Gelato crawl", notes: "", scheduledOn: null, seq: 0, lat: null, lng: null, placeLabel: "", convertedVisitId: null, createdAt: "" },
  ]),
  listDocuments: vi.fn(async () => []),
  getRelations: vi.fn(async () => []),
  convertItineraryItem: vi.fn(async () => ({ visitId: "v1", item: {} })),
  createItineraryItem: vi.fn(async () => ({})), deleteItineraryItem: vi.fn(async () => {}),
  updateItineraryItem: vi.fn(async () => ({})), updateTrip: vi.fn(async () => ({})),
  createLink: vi.fn(), deleteLink: vi.fn(), searchEntities: vi.fn(async () => []),
  getTripPacking: vi.fn(async () => ({ list: null })),
  createTripPacking: vi.fn(), listPackingTemplates: vi.fn(async () => []),
  savePackingTemplate: vi.fn(), updatePackingItem: vi.fn(), addPackingItem: vi.fn(), deletePackingItem: vi.fn(),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { TripDetail } from "./TripDetail";

const trip = { id: "t1", name: "Italy 2025", status: "planning", startDate: "2025-06-03", endDate: "2025-06-14", color: "#2563eb", description: "" } as any;

test("shows itinerary + wishlist and converts a scheduled item", async () => {
  render(withQC(<TripDetail trip={trip} onClose={() => {}} onChanged={() => {}} />));
  expect(await screen.findByText("Colosseum")).toBeInTheDocument();
  expect(screen.getByText("Gelato crawl")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Convert Colosseum to a visit"));
  await waitFor(() => expect(h.convertItineraryItem).toHaveBeenCalledWith("i1"));
});
