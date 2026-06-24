import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({
  listTrips: vi.fn(async () => [{ id: "t1", name: "Italy 2025", status: "planning", startDate: "2025-06-01", endDate: "2025-06-14", color: "#2563eb", description: "" }]),
  listBlackouts: vi.fn(async () => []),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { PlanningPage } from "./PlanningPage";

test("renders the board and toggles to the timeline", async () => {
  render(withQC(<PlanningPage />));
  expect(await screen.findByText("Italy 2025")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Timeline/ }));
  // Still shows the trip (now as a bar) after toggling:
  expect(screen.getByText(/Italy 2025/)).toBeInTheDocument();
});
