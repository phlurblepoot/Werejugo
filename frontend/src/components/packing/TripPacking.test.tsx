import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const h = vi.hoisted(() => ({
  getTripPacking: vi.fn(async () => ({ list: { id: "l1", name: "Packing", tripId: "t1", isBuiltin: false, itemCount: 1, checkedCount: 0,
    items: [{ id: "a", label: "Socks", category: "Clothes", qty: null, checked: false, seq: 0 }] } })),
  savePackingTemplate: vi.fn(async () => ({ id: "tpl9" })),
  updatePackingItem: vi.fn(async () => ({})), addPackingItem: vi.fn(async () => ({})), deletePackingItem: vi.fn(async () => {}),
  createTripPacking: vi.fn(), listPackingTemplates: vi.fn(async () => []), listTrips: vi.fn(async () => []),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { TripPacking } from "./TripPacking";

const trip = { id: "t1", name: "Italy" } as any;

test("shows the trip's checklist and saves it as a template", async () => {
  // window.prompt is used to name the template
  vi.spyOn(window, "prompt").mockReturnValue("Italy base");
  render(withQC(<TripPacking trip={trip} />));
  expect(await screen.findByText("Socks")).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Save as template/));
  await waitFor(() => expect(h.savePackingTemplate).toHaveBeenCalledWith({ name: "Italy base", fromListId: "l1" }));
});
