import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { deletePhoto } = vi.hoisted(() => ({ deletePhoto: vi.fn(async () => {}) }));
vi.mock("../../api/client", () => ({ API_URL: "", api: { deletePhoto, updatePhoto: vi.fn(), uploadMedia: vi.fn(), createLink: vi.fn() } }));
import { VisitPhotos } from "./VisitPhotos";

test("stages selected files and reports them", () => {
  const onStaged = vi.fn();
  render(<VisitPhotos visitId={null} existing={[]} staged={[]} onStaged={onStaged} onExistingChanged={() => {}} />);
  const input = screen.getByTestId("visit-photo-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  expect(onStaged).toHaveBeenCalled();
  expect(onStaged.mock.calls[0][0]).toHaveLength(1);
});
