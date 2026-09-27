import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { deletePhoto } = vi.hoisted(() => ({ deletePhoto: vi.fn(async () => {}) }));
vi.mock("../../api/client", () => ({ API_URL: "", api: { deletePhoto, updatePhoto: vi.fn(), createLink: vi.fn() } }));
import { VisitPhotos } from "./VisitPhotos";
import { fakeUploads, withUploads } from "../../test/uploads";

test("stages selected files and reports them", () => {
  const onStaged = vi.fn();
  render(<VisitPhotos visitId={null} existing={[]} staged={[]} onStaged={onStaged} />);
  const input = screen.getByTestId("visit-photo-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  expect(onStaged).toHaveBeenCalled();
  expect(onStaged.mock.calls[0][0]).toHaveLength(1);
});

test("a saved place's upload appears in its photos at once, and only refreshes the map", async () => {
  const { manager } = fakeUploads();
  const onPhotosChanged = vi.fn();
  render(withUploads(<VisitPhotos visitId="v1" existing={[]} staged={[]} onStaged={() => {}} onPhotosChanged={onPhotosChanged} />, manager));
  fireEvent.change(screen.getByTestId("media-input"), { target: { files: [new File(["x"], "beach.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(onPhotosChanged).toHaveBeenCalled());
  expect(document.querySelectorAll(".photo-tile")).toHaveLength(1);
});
