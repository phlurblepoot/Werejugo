import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const { listMedia, listTrips, getMedia } = vi.hoisted(() => ({
  listMedia: vi.fn(async () => ({ items: [{ id: "a", kind: "image", tripId: null, url: "/api/files/a?sig=1", thumbUrl: "/api/files/a.t?sig=1", caption: "Sunset", takenAt: "2024-06-10T10:00:00Z", createdAt: "", width: null, height: null, lng: null, lat: null, cursor: "c1" }], nextCursor: null })),
  listTrips: vi.fn(async () => []),
  getMedia: vi.fn(async (id: string) => ({ id, kind: "image", tripId: null, url: `/api/files/${id}?sig=1`, thumbUrl: null, caption: "The linked one", takenAt: null, createdAt: "", width: null, height: null, lng: null, lat: null, familyId: "f1" })),
}));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { familyId: "f1" } }) }));
vi.mock("../api/client", () => ({ API_URL: "", api: { listMedia, listTrips, getMedia } }));
import { PhotosPage } from "./PhotosPage";

test("renders the library grid from listMedia", async () => {
  render(withQC(<MemoryRouter><PhotosPage /></MemoryRouter>));
  expect(await screen.findByText(/June 2024/)).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Sunset" })).toBeInTheDocument();
});

test("/photos?photo=<id> opens that photo, even when it isn't on the first page", async () => {
  render(withQC(<MemoryRouter initialEntries={["/photos?photo=zzz"]}><PhotosPage /></MemoryRouter>));
  expect(await screen.findByRole("img", { name: "The linked one" })).toHaveAttribute("src", "/api/files/zzz?sig=1");
  expect(getMedia).toHaveBeenCalledWith("zzz");
});
