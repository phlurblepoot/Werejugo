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
  searchMedia: vi.fn(async (): Promise<unknown> => ({ items: [], nextPage: null })),
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

test("what's in the photos: Immich's smart search, a moment after typing stops", async () => {
  h.searchMedia.mockResolvedValue({ items: [
    { id: "m1", caption: "", originalName: "IMG_1.jpg", thumbUrl: "/api/m/m1/thumbnail" },
    { id: "m2", caption: "Sunset", originalName: "IMG_2.jpg", thumbUrl: "/api/m/m2/thumbnail" },
  ], nextPage: null });
  render(withQC(<MemoryRouter><CommandPalette open onClose={() => {}} /></MemoryRouter>));
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "be" } });
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "beach sunset" } });
  fireEvent.click(await screen.findByRole("button", { name: "Photo: Sunset" }));
  expect(h.searchMedia).toHaveBeenCalledWith("beach sunset");
  expect(h.searchMedia).not.toHaveBeenCalledWith("be");
  expect(nav).toHaveBeenCalledWith("/photos?photo=m2");
});

test("all the photos of a search open on the Photos page", async () => {
  h.searchMedia.mockResolvedValue({ items: [{ id: "m1", caption: "", originalName: "IMG_1.jpg", thumbUrl: "/api/m/m1/thumbnail" }], nextPage: null });
  render(withQC(<MemoryRouter><CommandPalette open onClose={() => {}} /></MemoryRouter>));
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "red car" } });
  fireEvent.click(await screen.findByRole("button", { name: "All photos of “red car”" }));
  expect(nav).toHaveBeenCalledWith("/photos?q=red%20car");
});

test("with Immich's machine learning off, it says so", async () => {
  h.searchMedia.mockRejectedValue(Object.assign(new Error("off"), { status: 409 }));
  render(withQC(<MemoryRouter><CommandPalette open onClose={() => {}} /></MemoryRouter>));
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "beach" } });
  expect(await screen.findByText(/needs Immich's machine learning/)).toBeInTheDocument();
});
