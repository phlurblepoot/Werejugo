import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const h = vi.hoisted(() => ({
  listBlackouts: vi.fn(async () => [{ id: "b1", label: "School", startDate: "2025-09-01", endDate: "2026-06-15", color: "#64748b", createdAt: "" }]),
  createBlackout: vi.fn(async () => ({ id: "b2" })), deleteBlackout: vi.fn(async () => {}), updateBlackout: vi.fn(),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { BlackoutManager } from "./BlackoutManager";

test("lists blackouts and adds one", async () => {
  render(withQC(<BlackoutManager onClose={() => {}} />));
  expect(await screen.findByText("School")).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/label/i), { target: { value: "Work crunch" } });
  fireEvent.change(screen.getByLabelText("Blackout start"), { target: { value: "2025-11-01" } });
  fireEvent.change(screen.getByLabelText("Blackout end"), { target: { value: "2025-11-15" } });
  fireEvent.click(screen.getByText("Add blackout"));
  await waitFor(() => expect(h.createBlackout).toHaveBeenCalledWith(expect.objectContaining({ label: "Work crunch", startDate: "2025-11-01", endDate: "2025-11-15" })));
});
