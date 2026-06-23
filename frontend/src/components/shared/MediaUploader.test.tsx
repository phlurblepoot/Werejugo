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
