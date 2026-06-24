import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DocumentList } from "./DocumentList";

const docs = [
  { id: "d1", title: "Dad's Passport", docType: "passport", ownerPersonName: "Dad", ownerTripName: null, status: "upcoming", daysUntilExpiry: 74, expiresOn: "2031-04-11" },
  { id: "d2", title: "Old Visa", docType: "visa", ownerPersonName: null, ownerTripName: null, status: "overdue", daysUntilExpiry: -5, expiresOn: "2024-01-01" },
] as any;

test("renders rows with status and opens one on click", () => {
  const onOpen = vi.fn();
  render(<DocumentList documents={docs} onOpen={onOpen} />);
  expect(screen.getByText("Dad's Passport")).toBeInTheDocument();
  expect(screen.getByText(/74 days/)).toBeInTheDocument();
  expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Dad's Passport"));
  expect(onOpen).toHaveBeenCalledWith(docs[0]);
});
