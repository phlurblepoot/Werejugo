import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { withApp } from "../../test/app";
const h = vi.hoisted(() => ({
  updatePhoto: vi.fn(async () => ({})), deletePhoto: vi.fn(async () => {}),
  setMediaTrip: vi.fn(async () => ({})), getRelations: vi.fn(async () => []),
  setMediaHidden: vi.fn(async (_id: string, hidden: boolean) => ({ hidden })),
  createLink: vi.fn(), deleteLink: vi.fn(), searchEntities: vi.fn(async () => []),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { PhotoViewer } from "./PhotoViewer";

const item = { id: "m1", kind: "image", tripId: null, url: "/api/m/m1/preview", thumbUrl: null, caption: "Hi", takenAt: "2024-06-10T10:00:00Z", createdAt: "", width: null, height: null, lng: 12.5, lat: 41.9, cursor: "c" } as never;

test("the caption is saved as you leave the field; Delete asks first", async () => {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(withApp(<PhotoViewer item={item} trips={[]} onChanged={onChanged} onClose={onClose} />));
  const cap = screen.getByDisplayValue("Hi");
  fireEvent.change(cap, { target: { value: "Sunset" } });
  fireEvent.blur(cap);
  await waitFor(() => expect(h.updatePhoto).toHaveBeenCalledWith("m1", "Sunset"));

  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  const confirm = await screen.findByRole("dialog", { name: "Delete this photo?" });
  expect(confirm).toHaveTextContent(/Immich trash/);
  await userEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(h.deletePhoto).toHaveBeenCalledWith("m1"));
  expect(onClose).toHaveBeenCalled();
});

test("hiding from the library and showing again", async () => {
  const onChanged = vi.fn();
  render(withApp(<PhotoViewer item={item} trips={[]} onChanged={onChanged} onClose={() => {}} />));
  await userEvent.click(screen.getByRole("button", { name: "Hide from library" }));
  expect(h.setMediaHidden).toHaveBeenCalledWith("m1", true);
  expect(await screen.findByText(/Hidden from the library/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show in library" }));
  expect(h.setMediaHidden).toHaveBeenLastCalledWith("m1", false);
  expect(onChanged).toHaveBeenCalledTimes(2);
});

test("another family's photo is view-only", () => {
  render(withApp(<PhotoViewer item={{ ...(item as object), familyId: "f2", familyName: "The Smiths" } as never} trips={[]} onChanged={() => {}} onClose={() => {}} myFamilyId="f1" />));
  expect(screen.getByText(/Added by The Smiths/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Hide from library" })).toBeNull();
  expect(screen.queryByPlaceholderText("Caption…")).toBeNull();
});

test("the original can be downloaded; videos play from their own link, with the still as poster", () => {
  const video = { ...(item as object), kind: "video", url: "/api/m/m1/preview?e=1&s=x", videoUrl: "/api/m/m1/video?e=1&s=x", originalUrl: "/api/m/m1/original?e=1&s=x", originalName: "clip.mov", caption: "Waves" };
  render(withApp(<PhotoViewer item={video as never} trips={[]} onChanged={() => {}} onClose={() => {}} />));
  const player = screen.getByLabelText("Waves", { selector: "video" });
  expect(player).toHaveAttribute("src", "/api/m/m1/video?e=1&s=x");
  expect(player).toHaveAttribute("poster", "/api/m/m1/preview?e=1&s=x");
  const link = screen.getByRole("link", { name: "Download original" });
  expect(link).toHaveAttribute("href", "/api/m/m1/original?e=1&s=x");
  expect(link).toHaveAttribute("download", "clip.mov");
});

test("arrows step through photos; at the end the button says so", async () => {
  const next = { ...(item as object), id: "m2", caption: "Next one", url: "/api/m/m2/preview" };
  const onStep = vi.fn(async (dir: 1 | -1) => (dir === 1 ? (next as never) : null));
  render(withApp(<PhotoViewer item={item} trips={[]} onChanged={() => {}} onClose={() => {}} onStep={onStep} />));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByRole("img", { name: "Next one" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Previous" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled());
  // Typing in the caption doesn't step.
  onStep.mockClear();
  const cap = screen.getByDisplayValue("Next one");
  cap.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(onStep).not.toHaveBeenCalled();
});
