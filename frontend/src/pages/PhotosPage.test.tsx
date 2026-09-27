import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { withApp } from "../test/app";
import { withElementSize } from "../test/size";

const item = (id: string, month: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "image", tripId: null, url: `/p/${id}`, thumbUrl: `/t/${id}`, caption: id, takenAt: `${month}-10T10:00:00Z`,
  createdAt: "", width: null, height: null, lng: null, lat: null, cursor: "", familyId: "f1", ...extra,
});
const h = vi.hoisted(() => ({
  immichStatus: vi.fn(async (): Promise<{ enabled: boolean; state: string; lastSyncAt: string | null; photoCount: number | null }> =>
    ({ enabled: true, state: "created", lastSyncAt: new Date().toISOString(), photoCount: 1 })),
  refreshImmich: vi.fn(async () => ({ queued: true })),
  mediaTimeline: vi.fn(),
  listMedia: vi.fn(),
  listTrips: vi.fn(async () => [{ id: "t1", name: "Italy" }]),
  getMedia: vi.fn(),
  bulkMedia: vi.fn(async () => ({ updated: 2 })),
  deletePhoto: vi.fn(async () => {}),
  getRelations: vi.fn(async () => []),
  searchEntities: vi.fn(async () => []),
}));
const auth = vi.hoisted(() => ({ user: { familyId: "f1", isAdmin: false } as Record<string, unknown> }));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { PhotosPage } from "./PhotosPage";

const LIB: Record<string, ReturnType<typeof item>[]> = {
  "2024-06": [item("sunset", "2024-06"), item("beach", "2024-06")],
  "2024-05": [item("may", "2024-05")],
};
h.mediaTimeline.mockImplementation(async () => ({ months: [{ month: "2024-06", count: 2 }, { month: "2024-05", count: 1 }], total: 3 }));
h.listMedia.mockImplementation(async (f: { month: string }) => ({ items: LIB[f.month] ?? [], nextCursor: null }));
h.getMedia.mockImplementation(async (id: string) => item(id, "2023-01", { caption: "The linked one" }));

withElementSize(900, 700);
const page = (entry = "/photos") => render(withApp(<MemoryRouter initialEntries={[entry]}><PhotosPage /></MemoryRouter>));

test("the library is a timeline of months", async () => {
  page();
  expect(await screen.findByText("June 2024")).toBeInTheDocument();
  expect(await screen.findByLabelText("Photo: sunset")).toBeInTheDocument();
  expect(screen.getByText("May 2024")).toBeInTheDocument();
});

test("a photo opens full-screen, and → steps to the next one across months", async () => {
  page();
  await userEvent.click(await screen.findByLabelText("Photo: beach"));
  const viewer = await screen.findByRole("dialog", { name: "beach" });
  expect(within(viewer).getByRole("img", { name: "beach" })).toHaveAttribute("src", "/p/beach");
  await userEvent.keyboard("{ArrowRight}");
  expect(await screen.findByRole("dialog", { name: "may" })).toBeInTheDocument();
  await userEvent.keyboard("{ArrowLeft}");
  expect(await screen.findByRole("dialog", { name: "beach" })).toBeInTheDocument();
});

test("/photos?photo=<id> opens that photo, even when it isn't in view", async () => {
  page("/photos?photo=zzz");
  expect(await screen.findByRole("img", { name: "The linked one" })).toHaveAttribute("src", "/p/zzz");
  expect(h.getMedia).toHaveBeenCalledWith("zzz");
});

test("selecting photos, then hiding them or putting them in a trip", async () => {
  page();
  await userEvent.click(await screen.findByRole("button", { name: "Select photos" }));
  await userEvent.click(await screen.findByLabelText("Photo: sunset"));
  await userEvent.click(screen.getByLabelText("Photo: beach"));
  const bar = screen.getByRole("toolbar", { name: "Selected photos" });
  expect(within(bar).getByText("2 selected")).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole("button", { name: "Hide" }));
  await waitFor(() => expect(h.bulkMedia).toHaveBeenCalledWith({ mediaIds: ["sunset", "beach"], hidden: true }));
  expect(screen.queryByRole("toolbar", { name: "Selected photos" })).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Select photos" }));
  await userEvent.click(await screen.findByLabelText("Photo: may"));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Add to trip" }), "t1");
  await waitFor(() => expect(h.bulkMedia).toHaveBeenCalledWith({ mediaIds: ["may"], tripId: "t1" }));
});

test("the Hidden filter shows hidden photos, with Show instead of Hide", async () => {
  page();
  await userEvent.click(await screen.findByRole("button", { name: "Hidden" }));
  await waitFor(() => expect(h.mediaTimeline).toHaveBeenLastCalledWith({ hidden: "only" }));
  await userEvent.click(screen.getByRole("button", { name: "Select photos" }));
  await userEvent.click(await screen.findByLabelText("Photo: sunset"));
  expect(within(screen.getByRole("toolbar", { name: "Selected photos" })).getByRole("button", { name: "Show" })).toBeInTheDocument();
});

test("without Immich, the page explains instead of showing an empty library", async () => {
  h.immichStatus.mockResolvedValueOnce({ enabled: false, state: "none", lastSyncAt: null, photoCount: null });
  page();
  expect(await screen.findByText("Photos need Immich")).toBeInTheDocument();
  expect(screen.getByText(/Ask the server admin/)).toBeInTheDocument();
  expect(screen.queryByText("Upload")).toBeNull();
});

test("the admin is pointed at Admin → Immich", async () => {
  h.immichStatus.mockResolvedValueOnce({ enabled: false, state: "none", lastSyncAt: null, photoCount: null });
  auth.user = { familyId: "f1", isAdmin: true };
  page();
  expect(await screen.findByRole("link", { name: "Admin → Immich" })).toHaveAttribute("href", "/admin?tab=immich");
  auth.user = { familyId: "f1", isAdmin: false };
});

test("'Refresh from Immich' asks for a sync and says when the library was last updated", async () => {
  page();
  const btn = await screen.findByRole("button", { name: /Refresh from Immich \(updated/ });
  await userEvent.click(btn);
  await waitFor(() => expect(h.refreshImmich).toHaveBeenCalled());
});
