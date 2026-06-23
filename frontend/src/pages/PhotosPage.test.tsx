import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const { listMedia, listTrips } = vi.hoisted(() => ({
  listMedia: vi.fn(async () => ({ items: [{ id: "a", kind: "image", tripId: null, url: "/api/files/a?sig=1", thumbUrl: "/api/files/a.t?sig=1", caption: "Sunset", takenAt: "2024-06-10T10:00:00Z", createdAt: "", width: null, height: null, lng: null, lat: null, cursor: "c1" }], nextCursor: null })),
  listTrips: vi.fn(async () => []),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: { listMedia, listTrips } }));
import { PhotosPage } from "./PhotosPage";

test("renders the library grid from listMedia", async () => {
  render(withQC(<PhotosPage />));
  expect(await screen.findByText(/June 2024/)).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Sunset" })).toBeInTheDocument();
});
