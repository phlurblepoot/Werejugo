import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const { listDocuments } = vi.hoisted(() => ({
  listDocuments: vi.fn(async () => [
    { id: "d1", title: "Old Visa", docType: "visa", ownerPersonName: null, ownerTripName: null, status: "overdue", daysUntilExpiry: -5, expiresOn: "2024-01-01", fileUrl: null, originalName: "", notes: "", reminderLeadDays: 30, issuedOn: null, ownerPersonId: null, ownerTripId: null, createdAt: "" },
    { id: "d2", title: "Booking", docType: "booking", ownerPersonName: null, ownerTripName: null, status: "none", daysUntilExpiry: null, expiresOn: null, fileUrl: null, originalName: "", notes: "", reminderLeadDays: 30, issuedOn: null, ownerPersonId: null, ownerTripId: null, createdAt: "" },
  ]),
}));
const h = vi.hoisted(() => ({
  getDocument: vi.fn(),
  listPeople: vi.fn(async () => []),
  listTrips: vi.fn(async () => []),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: { listDocuments, ...h } }));
import { DocumentsPage } from "./DocumentsPage";

test("shows the renewals banner with the overdue doc and lists all", async () => {
  render(withQC(<MemoryRouter><DocumentsPage /></MemoryRouter>));
  expect(await screen.findByText(/Coming up/)).toBeInTheDocument();
  // Old Visa appears in both the banner and the list:
  expect(screen.getAllByText("Old Visa").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText("Booking")).toBeInTheDocument();
});

test("/documents?doc=<id> opens that document", async () => {
  h.getDocument.mockResolvedValueOnce({ id: "d7", title: "Dad's passport", docType: "passport", ownerPersonId: null, ownerPersonName: null, ownerTripId: null, ownerTripName: null, issuedOn: null, expiresOn: null, reminderLeadDays: 30, notes: "", fileUrl: null, originalName: "", createdAt: "", status: "none", daysUntilExpiry: null } as never);
  render(withQC(<MemoryRouter initialEntries={["/documents?doc=d7"]}><DocumentsPage /></MemoryRouter>));
  await waitFor(() => expect(h.getDocument).toHaveBeenCalledWith("d7"));
  expect(await screen.findByDisplayValue("Dad's passport")).toBeInTheDocument();
});
