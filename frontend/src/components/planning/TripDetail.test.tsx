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
  listShares: vi.fn(async () => []), createShare: vi.fn(), deleteShare: vi.fn(),
  tripMembers: vi.fn(async () => ({ myRole: "host", host: { familyId: "f1", familyName: "Us" }, members: [], invites: [] })),
  tripActivity: vi.fn(async () => []),
  tripAlbum: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: { familyId: "f1", role: "owner" } }) }));
vi.mock("../Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { TripDetail as TripDetailRaw } from "./TripDetail";
import { ConfirmProvider } from "../kit";
const TripDetail = (p: Parameters<typeof TripDetailRaw>[0]) => <ConfirmProvider><TripDetailRaw {...p} /></ConfirmProvider>;

const trip = { id: "t1", name: "Italy 2025", status: "planning", startDate: "2025-06-03", endDate: "2025-06-14", color: "#2563eb", description: "" } as any;

test("shows itinerary + wishlist and converts a scheduled item", async () => {
  render(withQC(<TripDetail trip={trip} onClose={() => {}} onChanged={() => {}} />));
  expect(await screen.findByText("Colosseum")).toBeInTheDocument();
  expect(screen.getByText("Gelato crawl")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Convert Colosseum to a visit"));
  await waitFor(() => expect(h.convertItineraryItem).toHaveBeenCalledWith("i1"));
});

test("offers a Share action for the trip", async () => {
  render(withQC(<TripDetail trip={trip} onClose={() => {}} onChanged={() => {}} />));
  expect(await screen.findByText(/Share/)).toBeInTheDocument();
});

test("a guest family sees who hosts it, can't change the trip, and only edits its own plans", async () => {
  h.listItinerary.mockResolvedValueOnce([
    { id: "i3", tripId: "t1", title: "Their idea", notes: "", scheduledOn: null, seq: 0, lat: null, lng: null, placeLabel: "", convertedVisitId: null, createdAt: "", familyId: "f2", familyName: "The Hosts", canEdit: false },
    { id: "i4", tripId: "t1", title: "Our idea", notes: "", scheduledOn: null, seq: 1, lat: null, lng: null, placeLabel: "", convertedVisitId: null, createdAt: "", familyId: "f1", familyName: "Us", canEdit: true },
  ] as never);
  h.tripMembers.mockResolvedValueOnce({ myRole: "contributor", host: { familyId: "f2", familyName: "The Hosts" }, members: [{ familyId: "f1", familyName: "Us", role: "contributor", joinedAt: "2026-09-01T00:00:00Z", isYou: true }], invites: [] } as never);
  const guestTrip = { ...trip, role: "contributor", hostFamilyName: "The Hosts", shared: true };
  render(withQC(<TripDetail trip={guestTrip} onClose={() => {}} onChanged={() => {}} />));
  expect(await screen.findByText("Their idea")).toBeInTheDocument();
  expect(screen.getByText("Contributor · hosted by The Hosts")).toBeInTheDocument();
  expect(screen.queryByLabelText("Status")).toBeNull();
  expect(screen.queryByLabelText("Delete Their idea")).toBeNull();
  expect(screen.getByLabelText("Delete Our idea")).toBeInTheDocument();
  expect(screen.getByTitle("Added by The Hosts")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /Leave this trip/ })).toBeInTheDocument();
  expect(screen.getAllByText(/only your family sees/).length).toBe(2);
});

test("says the trip is also an album in Immich, or why the album couldn't be updated", async () => {
  h.tripAlbum.mockResolvedValueOnce({ name: "Italy 2025", assetCount: 12, syncedAt: new Date().toISOString(), error: null });
  const { unmount } = render(withQC(<TripDetail trip={trip} onClose={() => {}} onChanged={() => {}} />));
  expect(await screen.findByText(/Also an album in Immich:/)).toHaveTextContent("Also an album in Immich: Italy 2025 · up to date just now");
  unmount();

  h.tripAlbum.mockResolvedValueOnce({ name: "Italy 2025", assetCount: 12, syncedAt: null, error: "Immich didn't answer" });
  render(withQC(<TripDetail trip={trip} onClose={() => {}} onChanged={() => {}} />));
  expect(await screen.findByText(/couldn't be updated/)).toHaveTextContent("Its album in Immich, “Italy 2025”, couldn't be updated: Immich didn't answer.");
});

test("no album line without Immich", async () => {
  render(withQC(<TripDetail trip={trip} onClose={() => {}} onChanged={() => {}} />));
  await waitFor(() => expect(h.tripAlbum).toHaveBeenCalledWith("t1"));
  expect(screen.queryByText(/album in Immich/)).toBeNull();
});
