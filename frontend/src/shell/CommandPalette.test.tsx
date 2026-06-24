import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";

const nav = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<any>()), useNavigate: () => nav }));
const h = vi.hoisted(() => ({
  search: vi.fn(async () => ({
    people: [], visits: [], photos: [], documents: [],
    trips: [{ type: "trip", id: "t1", label: "Venice Trip", thumbUrl: null, to: "/planning?trip=t1" }],
  })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { CommandPalette } from "./CommandPalette";

test("typing searches and selecting a hit navigates", async () => {
  render(withQC(<MemoryRouter><CommandPalette open onClose={() => {}} /></MemoryRouter>));
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Venice" } });
  fireEvent.click(await screen.findByText("Venice Trip"));
  await waitFor(() => expect(nav).toHaveBeenCalledWith("/planning?trip=t1"));
});

test("renders nothing when closed", () => {
  const { container } = render(withQC(<MemoryRouter><CommandPalette open={false} onClose={() => {}} /></MemoryRouter>));
  expect(container).toBeEmptyDOMElement();
});
