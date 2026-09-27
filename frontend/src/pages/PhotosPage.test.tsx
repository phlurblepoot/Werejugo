import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
import { withUploads } from "../test/uploads";
const { listMedia, listTrips, getMedia, immichStatus, refreshImmich } = vi.hoisted(() => ({
  immichStatus: vi.fn(async (): Promise<{ enabled: boolean; state: string; lastSyncAt: string | null; photoCount: number | null }> =>
    ({ enabled: true, state: "created", lastSyncAt: new Date().toISOString(), photoCount: 1 })),
  refreshImmich: vi.fn(async () => ({ queued: true })),
  listMedia: vi.fn(async () => ({ items: [{ id: "a", kind: "image", tripId: null, url: "/api/files/a?sig=1", thumbUrl: "/api/files/a.t?sig=1", caption: "Sunset", takenAt: "2024-06-10T10:00:00Z", createdAt: "", width: null, height: null, lng: null, lat: null, cursor: "c1" }], nextCursor: null })),
  listTrips: vi.fn(async () => []),
  getMedia: vi.fn(async (id: string) => ({ id, kind: "image", tripId: null, url: `/api/files/${id}?sig=1`, thumbUrl: null, caption: "The linked one", takenAt: null, createdAt: "", width: null, height: null, lng: null, lat: null, familyId: "f1" })),
}));
const auth = vi.hoisted(() => ({ user: { familyId: "f1", isAdmin: false } as Record<string, unknown> }));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../api/client", () => ({ API_URL: "", api: { listMedia, listTrips, getMedia, immichStatus, refreshImmich } }));
import { PhotosPage } from "./PhotosPage";

test("renders the library grid from listMedia", async () => {
  render(withQC(withUploads(<MemoryRouter><PhotosPage /></MemoryRouter>)));
  expect(await screen.findByText(/June 2024/)).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Sunset" })).toBeInTheDocument();
});

test("/photos?photo=<id> opens that photo, even when it isn't on the first page", async () => {
  render(withQC(withUploads(<MemoryRouter initialEntries={["/photos?photo=zzz"]}><PhotosPage /></MemoryRouter>)));
  expect(await screen.findByRole("img", { name: "The linked one" })).toHaveAttribute("src", "/api/files/zzz?sig=1");
  expect(getMedia).toHaveBeenCalledWith("zzz");
});

test("without Immich, the page explains instead of showing an empty library", async () => {
  immichStatus.mockResolvedValueOnce({ enabled: false, state: "none", lastSyncAt: null, photoCount: null });
  render(withQC(withUploads(<MemoryRouter><PhotosPage /></MemoryRouter>)));
  expect(await screen.findByText("Photos need Immich")).toBeInTheDocument();
  expect(screen.getByText(/Ask the server admin/)).toBeInTheDocument();
  expect(screen.queryByText("Upload")).toBeNull();
});

test("the admin is pointed at Admin → Immich", async () => {
  immichStatus.mockResolvedValueOnce({ enabled: false, state: "none", lastSyncAt: null, photoCount: null });
  auth.user = { familyId: "f1", isAdmin: true };
  render(withQC(withUploads(<MemoryRouter><PhotosPage /></MemoryRouter>)));
  expect(await screen.findByRole("link", { name: "Admin → Immich" })).toHaveAttribute("href", "/admin?tab=immich");
  auth.user = { familyId: "f1", isAdmin: false };
});

test("'Refresh from Immich' asks for a sync and says when the library was last updated", async () => {
  render(withQC(withUploads(<MemoryRouter><PhotosPage /></MemoryRouter>)));
  const btn = await screen.findByRole("button", { name: /Refresh from Immich \(updated/ });
  await userEvent.click(btn);
  await waitFor(() => expect(refreshImmich).toHaveBeenCalled());
});
