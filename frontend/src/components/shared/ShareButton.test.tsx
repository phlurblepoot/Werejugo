import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  listShares: vi.fn(async () => []),
  createShare: vi.fn(async () => ({ id: "s1", token: "abcdefghijabcdefghij", targetType: "trip", targetId: "t1", createdAt: "" })),
  deleteShare: vi.fn(async () => {}),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
import { ShareButton } from "./ShareButton";

test("opens, creates a link, and shows the public URL", async () => {
  render(<ShareButton targetType="trip" targetId="t1" label="Share" />);
  fireEvent.click(screen.getByText(/Share/));
  fireEvent.click(await screen.findByText("+ Create link"));
  await waitFor(() => expect(h.createShare).toHaveBeenCalledWith("trip", "t1"));
  expect(await screen.findByText(/\/s\/abcdefghijabcdefghij/)).toBeInTheDocument();
});
