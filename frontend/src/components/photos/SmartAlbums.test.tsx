import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { withApp } from "../../test/app";

const h = vi.hoisted(() => ({
  updateSmartAlbum: vi.fn(async (id: string, b: { name?: string; filters?: object }) => ({ id, name: b.name ?? "Sunsets", filters: b.filters ?? { q: "sunset" }, createdAt: "", updatedAt: "" })),
  deleteSmartAlbum: vi.fn(async () => undefined),
  listShares: vi.fn(async () => []),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { AlbumBar, albumFilters, sameFilters } from "./SmartAlbums";

const album = { id: "sa1", name: "Sunsets", filters: { q: "sunset" }, createdAt: "", updatedAt: "" };
beforeEach(() => vi.clearAllMocks());

test("what a smart album keeps from the page", () => {
  expect(albumFilters({ trip: "t1", kind: undefined, from: "" }, "  sunset ")).toEqual({ trip: "t1", q: "sunset" });
  expect(albumFilters({}, "")).toEqual({});
  expect(sameFilters({ q: "sunset" }, { q: "sunset" })).toBe(true);
  expect(sameFilters({ q: "sunset" }, { q: "sunset", trip: "t1" })).toBe(false);
});

test("the open album: rename it, or update it to the current search", async () => {
  const onChanged = vi.fn();
  render(withApp(<AlbumBar album={album} current={{ q: "sunset", kind: "image" }} onClose={() => {}} onChanged={onChanged} />));
  await userEvent.click(screen.getByRole("button", { name: "Update album" }));
  await waitFor(() => expect(h.updateSmartAlbum).toHaveBeenCalledWith("sa1", { filters: { q: "sunset", kind: "image" } }));

  await userEvent.click(screen.getByRole("button", { name: "Rename album" }));
  const name = screen.getByLabelText("Album name");
  await userEvent.clear(name);
  await userEvent.type(name, "Golden hour{Enter}");
  await waitFor(() => expect(h.updateSmartAlbum).toHaveBeenCalledWith("sa1", { name: "Golden hour" }));
});

test("no Update when the page shows what the album keeps; deleting asks first", async () => {
  const onChanged = vi.fn();
  render(withApp(<AlbumBar album={album} current={{ q: "sunset" }} onClose={() => {}} onChanged={onChanged} />));
  expect(screen.queryByRole("button", { name: "Update album" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Delete album" }));
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await waitFor(() => expect(h.deleteSmartAlbum).toHaveBeenCalledWith("sa1"));
  expect(onChanged).toHaveBeenCalledWith(null);
});
