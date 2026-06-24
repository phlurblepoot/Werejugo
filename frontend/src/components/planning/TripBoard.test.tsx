import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "" }));
import { TripBoard } from "./TripBoard";

const trips = [
  { id: "t1", name: "Japan", status: "idea", startDate: null, endDate: null, color: "#2563eb" },
  { id: "t2", name: "Italy", status: "planning", startDate: "2025-06-01", endDate: "2025-06-14", color: "#16a34a" },
] as any;

test("groups trips into status columns and changes status", () => {
  const onStatusChange = vi.fn();
  render(<TripBoard trips={trips} onOpen={() => {}} onStatusChange={onStatusChange} />);
  // Both column headers and cards present:
  expect(screen.getByText("Japan")).toBeInTheDocument();
  expect(screen.getByText("Italy")).toBeInTheDocument();
  // Move Japan from idea → booked via its card's select:
  const select = screen.getByLabelText("Status for Japan");
  fireEvent.change(select, { target: { value: "booked" } });
  expect(onStatusChange).toHaveBeenCalledWith(trips[0], "booked");
});
