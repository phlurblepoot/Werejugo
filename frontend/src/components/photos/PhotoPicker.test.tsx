import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { withApp } from "../../test/app";
import { withElementSize } from "../../test/size";

const m = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "image", tripId: null, url: `/p/${id}`, thumbUrl: `/t/${id}`, caption: id, takenAt: "2024-06-10T10:00:00Z",
  createdAt: "", width: null, height: null, lng: null, lat: null, cursor: "", attached: false, match: "both", ...extra,
});
const h = vi.hoisted(() => ({
  mediaFor: vi.fn(),
  attachMedia: vi.fn(async (ids: string[]) => ({ attached: ids.length, skipped: [] })),
  mediaTimeline: vi.fn(async () => ({ months: [{ month: "2024-06", count: 3 }, { month: "2019-01", count: 1 }], total: 4 })),
  listMedia: vi.fn(async (f: { month: string }) => ({
    items: f.month === "2024-06" ? [m("both1"), m("date1"), m("other")] : [m("old")], nextCursor: null,
  })),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { PhotoPicker } from "./PhotoPicker";

withElementSize(900, 700);

test("opens on the photos taken then and there; those matching both start ticked; Add attaches them", async () => {
  h.mediaFor.mockResolvedValueOnce({
    label: "Colosseum", window: { from: "2024-06-10", to: "2024-06-10" }, near: true, month: "2024-06",
    items: [m("both1"), m("date1", { match: "date" }), m("place1", { match: "place" })],
  });
  const onClose = vi.fn();
  render(withApp(<PhotoPicker entity="visit:v1" onClose={onClose} />));
  const dialog = await screen.findByRole("dialog", { name: "Add photos to Colosseum" });
  expect(within(dialog).getByText(/Taken on 2024-06-10 or nearby/)).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Photo: both1")).toHaveAttribute("aria-pressed", "true");
  expect(within(dialog).getByLabelText("Photo: date1")).toHaveAttribute("aria-pressed", "false");

  await userEvent.click(within(dialog).getByLabelText("Photo: date1"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Add 2 photos" }));
  await waitFor(() => expect(h.attachMedia).toHaveBeenCalledWith(["both1", "date1"], "visit:v1"));
  expect(onClose).toHaveBeenCalled();
  expect(await screen.findByText("Added 2 photos")).toBeInTheDocument();
});

test("photos already added show as such, and nothing starts ticked", async () => {
  h.mediaFor.mockResolvedValueOnce({ label: "Tahoe", window: null, near: false, month: "2024-06", items: [m("a", { attached: true }), m("b")] });
  render(withApp(<PhotoPicker entity="trip:t1" onClose={() => {}} />));
  const added = await screen.findByLabelText("Photo: a (already added)");
  expect(added).toBeDisabled();
  expect(screen.getByLabelText("Photo: b")).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: /^Add/ })).toBeDisabled();
});

test("with no suggestions it opens on the whole library, at the item's month", async () => {
  h.mediaFor.mockResolvedValueOnce({ label: "Grandma", window: null, near: false, month: "2019-01", items: [] });
  render(withApp(<PhotoPicker entity="person:p1" onClose={() => {}} />));
  expect(await screen.findByText("January 2019")).toBeInTheDocument();
  await userEvent.click(await screen.findByLabelText("Photo: old"));
  await userEvent.click(screen.getByRole("button", { name: "Add 1 photo" }));
  await waitFor(() => expect(h.attachMedia).toHaveBeenCalledWith(["old"], "person:p1"));
});

test("'Upload new' is there when uploads can be linked to the item", async () => {
  h.mediaFor.mockResolvedValueOnce({ label: "Rome", window: null, near: false, month: null, items: [] });
  render(withApp(<PhotoPicker entity="trip:t1" uploadLinkTo="trip:t1" onClose={() => {}} />));
  expect(await screen.findByText("Upload new")).toBeInTheDocument();
});
