import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const { updatePackingItem, addPackingItem, deletePackingItem } = vi.hoisted(() => ({
  updatePackingItem: vi.fn(async () => ({})), addPackingItem: vi.fn(async () => ({})), deletePackingItem: vi.fn(async () => {}),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { updatePackingItem, addPackingItem, deletePackingItem } }));
import { PackingChecklist } from "./PackingChecklist";

const items = [
  { id: "a", label: "Swimsuit", category: "Clothes", qty: null, checked: false, seq: 0 },
  { id: "b", label: "Toothbrush", category: "Toiletries", qty: null, checked: true, seq: 0 },
] as any;

test("groups by category, shows progress, and toggles an item", async () => {
  render(withQC(<PackingChecklist listId="l1" items={items} onChanged={() => {}} />));
  expect(screen.getByText("Clothes")).toBeInTheDocument();
  expect(screen.getByText("Toiletries")).toBeInTheDocument();
  expect(screen.getByText("1/2 packed")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Swimsuit"));
  await waitFor(() => expect(updatePackingItem).toHaveBeenCalledWith("a", { checked: true }));
});

test("readOnly hides the add row and remove buttons", () => {
  render(withQC(<PackingChecklist listId="l1" items={items} readOnly onChanged={() => {}} />));
  expect(screen.queryByPlaceholderText(/Add item/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Remove/)).not.toBeInTheDocument();
});
