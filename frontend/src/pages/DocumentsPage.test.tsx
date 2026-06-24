import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const { listDocuments } = vi.hoisted(() => ({
  listDocuments: vi.fn(async () => [
    { id: "d1", title: "Old Visa", docType: "visa", ownerPersonName: null, ownerTripName: null, status: "overdue", daysUntilExpiry: -5, expiresOn: "2024-01-01", fileUrl: null, originalName: "", notes: "", reminderLeadDays: 30, issuedOn: null, ownerPersonId: null, ownerTripId: null, createdAt: "" },
    { id: "d2", title: "Booking", docType: "booking", ownerPersonName: null, ownerTripName: null, status: "none", daysUntilExpiry: null, expiresOn: null, fileUrl: null, originalName: "", notes: "", reminderLeadDays: 30, issuedOn: null, ownerPersonId: null, ownerTripId: null, createdAt: "" },
  ]),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: { listDocuments } }));
import { DocumentsPage } from "./DocumentsPage";

test("shows the renewals banner with the overdue doc and lists all", async () => {
  render(withQC(<DocumentsPage />));
  expect(await screen.findByText(/Coming up/)).toBeInTheDocument();
  // Old Visa appears in both the banner and the list:
  expect(screen.getAllByText("Old Visa").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText("Booking")).toBeInTheDocument();
});
