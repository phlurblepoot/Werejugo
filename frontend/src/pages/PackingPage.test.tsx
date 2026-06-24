import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({
  listPackingTemplates: vi.fn(async () => [{ id: "b1", name: "Beach", tripId: null, isBuiltin: true, itemCount: 5, checkedCount: 0 }]),
  listTrips: vi.fn(async () => [{ id: "t1", name: "Italy 2025", status: "planning", startDate: null, endDate: null, color: "#2563eb", description: "" }]),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { PackingPage } from "./PackingPage";

test("lists templates and trips", async () => {
  render(withQC(<PackingPage />));
  expect(await screen.findByText("Beach")).toBeInTheDocument();
  expect(screen.getByText("Italy 2025")).toBeInTheDocument();
});
