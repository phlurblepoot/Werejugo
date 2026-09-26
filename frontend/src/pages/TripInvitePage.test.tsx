import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({ tripInvitePreview: vi.fn(), acceptTripInvite: vi.fn(async () => ({ tripId: "t1", role: "contributor" })) }));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { TripInvitePage } from "./TripInvitePage";

const PREVIEW = {
  tripId: "t1", tripName: "Lake Tahoe 2025", startDate: "2025-07-10", endDate: "2025-07-17", hostFamilyName: "The Wanderers",
  invitedBy: "Demo", role: "contributor", expiresAt: "2026-10-03T00:00:00Z", alreadyOnTrip: false, canAccept: true,
};
const renderAt = () => render(withQC(
  <MemoryRouter initialEntries={["/trip-invite/tok"]}>
    <Routes>
      <Route path="/trip-invite/:token" element={<TripInvitePage />} />
      <Route path="/planning" element={<div>planning page</div>} />
    </Routes>
  </MemoryRouter>,
));

beforeEach(() => vi.clearAllMocks());

test("a family owner joins the trip", async () => {
  h.tripInvitePreview.mockResolvedValue(PREVIEW);
  renderAt();
  expect(await screen.findByText("Lake Tahoe 2025")).toBeInTheDocument();
  expect(screen.getByText(/The Wanderers invited your family/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Join this trip" }));
  await waitFor(() => expect(h.acceptTripInvite).toHaveBeenCalledWith("tok"));
  expect(await screen.findByText("planning page")).toBeInTheDocument();
});

test("members are told to ask their owner", async () => {
  h.tripInvitePreview.mockResolvedValue({ ...PREVIEW, canAccept: false });
  renderAt();
  expect(await screen.findByText(/Only a family owner can accept/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Join this trip" })).toBeNull();
});

test("a used invitation explains itself", async () => {
  h.tripInvitePreview.mockRejectedValue(new Error("gone"));
  renderAt();
  expect(await screen.findByText("This invitation isn't valid")).toBeInTheDocument();
});
