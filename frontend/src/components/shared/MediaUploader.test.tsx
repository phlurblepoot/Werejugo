import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { MediaUploader } from "./MediaUploader";
import { fakeUploads, withUploads } from "../../test/uploads";

const pick = (input: HTMLElement, ...files: File[]) => fireEvent.change(input, { target: { files } });
const jpg = (name = "a.jpg") => new File(["x"], name, { type: "image/jpeg" });

test("uploads through the upload manager and reports each photo, then the batch", async () => {
  const { manager, transport } = fakeUploads();
  const onUploaded = vi.fn();
  const onAllUploaded = vi.fn();
  render(withUploads(<MediaUploader multiple onUploaded={onUploaded} onAllUploaded={onAllUploaded} label="Add photos" />, manager));
  pick(screen.getByTestId("media-input"), jpg("a.jpg"), jpg("b.jpg"));
  await waitFor(() => expect(onAllUploaded).toHaveBeenCalledWith([expect.objectContaining({ id: "m1" }), expect.objectContaining({ id: "m2" })]));
  expect(onUploaded).toHaveBeenCalledTimes(2);
  expect(transport.create).toHaveBeenCalledWith(expect.objectContaining({ filename: "a.jpg", mime: "image/jpeg" }));
});

test("the link is made by the server: linkTo goes with the upload", async () => {
  const { manager, transport } = fakeUploads();
  render(withUploads(<MediaUploader onUploaded={() => {}} linkTo="person:p1" linkRole="avatar" />, manager));
  pick(screen.getByTestId("media-input"), jpg());
  await waitFor(() => expect(transport.create).toHaveBeenCalledWith(expect.objectContaining({ linkTo: "person:p1", linkRole: "avatar" })));
});

test("a photo already in the library says so, and iPhone/RAW files can be picked", async () => {
  const { manager } = fakeUploads((_n, i) => ({ id: `m${i}`, kind: "image", url: "/u", thumbUrl: null, caption: "", duplicate: true }));
  render(withUploads(<MediaUploader onUploaded={() => {}} />, manager));
  const input = screen.getByTestId("media-input") as HTMLInputElement;
  expect(input.accept).toMatch(/\.heic/);
  expect(input.accept).toMatch(/\.dng/);
  expect(input.accept).not.toMatch(/audio/);
  pick(input, new File(["x"], "IMG_0001.HEIC", { type: "image/heic" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Already in your library");
});

test("a file that fails shows why; a single-file picker says it's uploading meanwhile", async () => {
  const { manager, transport } = fakeUploads();
  (transport.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error("Only photos and videos can be added"), { status: 400 }));
  render(withUploads(<MediaUploader onUploaded={() => {}} label="Set photo" />, manager));
  pick(screen.getByTestId("media-input"), new File(["x"], "notes.txt", { type: "text/plain" }));
  expect(await screen.findByText("Only photos and videos can be added")).toBeInTheDocument();
  expect(screen.getByText("Set photo")).toBeInTheDocument();
});

test("picking the same file again uploads it again (the choice is cleared each time)", async () => {
  const { manager, transport } = fakeUploads();
  render(withUploads(<MediaUploader onUploaded={() => {}} />, manager));
  const input = screen.getByTestId("media-input") as HTMLInputElement;
  pick(input, jpg());
  await waitFor(() => expect(transport.create).toHaveBeenCalledTimes(1));
  expect(input.value).toBe("");
});
