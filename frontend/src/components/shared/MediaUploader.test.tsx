import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const { uploadMedia, createLink } = vi.hoisted(() => ({
  uploadMedia: vi.fn(async () => ({ id: "m1", kind: "image", url: "/api/files/x?sig=1", thumbUrl: null, caption: "" })),
  createLink: vi.fn(async () => ({ id: "l1" })),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { uploadMedia, createLink } }));
import { MediaUploader } from "./MediaUploader";

test("uploads a file and reports the media", async () => {
  const onUploaded = vi.fn();
  render(<MediaUploader onUploaded={onUploaded} label="Add photo" />);
  const input = screen.getByTestId("media-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" })));
  expect(createLink).not.toHaveBeenCalled();
});

test("links the upload when linkTo is given", async () => {
  render(<MediaUploader onUploaded={() => {}} linkTo="person:p1" />);
  const input = screen.getByTestId("media-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(createLink).toHaveBeenCalledWith("media:m1", "person:p1", ""));
});

test("a photo already in the library says so, and iPhone/RAW files can be picked", async () => {
  uploadMedia.mockResolvedValueOnce({ id: "m1", kind: "image", url: "/u", thumbUrl: null, caption: "", duplicate: true } as never);
  render(<MediaUploader onUploaded={() => {}} />);
  const input = screen.getByTestId("media-input") as HTMLInputElement;
  expect(input.accept).toMatch(/\.heic/);
  expect(input.accept).toMatch(/\.dng/);
  expect(input.accept).not.toMatch(/audio/);
  fireEvent.change(input, { target: { files: [new File(["x"], "IMG_0001.HEIC", { type: "image/heic" })] } });
  expect(await screen.findByRole("status")).toHaveTextContent("Already in your library");
});

test("picking the same file again uploads it again (the choice is cleared each time)", async () => {
  uploadMedia.mockClear();
  render(<MediaUploader onUploaded={() => {}} />);
  const input = screen.getByTestId("media-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(1));
  expect(input.value).toBe("");
});
