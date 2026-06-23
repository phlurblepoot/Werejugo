import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { getMediaSuggestions, applyMediaSuggestion } = vi.hoisted(() => ({
  getMediaSuggestions: vi.fn(async () => ({ trips: [{ tripId: "t1", name: "Italy 2024", mediaIds: ["m1", "m2"] }], visits: [] })),
  applyMediaSuggestion: vi.fn(async () => ({ applied: 2 })),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { getMediaSuggestions, applyMediaSuggestion } }));
import { UploadReview } from "./UploadReview";

test("shows a trip suggestion and applies it", async () => {
  render(<UploadReview mediaIds={["m1", "m2"]} onDone={() => {}} />);
  expect(await screen.findByText(/Italy 2024/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Link all"));
  await waitFor(() => expect(applyMediaSuggestion).toHaveBeenCalledWith({ mediaIds: ["m1", "m2"], tripId: "t1" }));
});
