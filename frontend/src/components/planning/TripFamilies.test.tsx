import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const h = vi.hoisted(() => ({
  tripMembers: vi.fn(),
  createTripInvite: vi.fn(async () => ({ id: "i1", token: "t", path: "/trip-invite/tok123", expiresAt: "2026-10-03T00:00:00Z" })),
  removeTripMember: vi.fn(async () => undefined),
  setTripMemberRole: vi.fn(async () => ({ ok: true })),
  revokeTripInvite: vi.fn(async () => undefined),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
const auth = vi.hoisted(() => ({ user: { familyId: "f1", role: "owner" } as Record<string, unknown> }));
vi.mock("../../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { TripFamilies } from "./TripFamilies";
import { ConfirmProvider } from "../kit";

const render_ = () => render(withQC(<ConfirmProvider><TripFamilies tripId="t1" tripName="Tahoe" /></ConfirmProvider>));

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { familyId: "f1", role: "owner" };
  h.tripMembers.mockResolvedValue({
    myRole: "host", host: { familyId: "f1", familyName: "The Wanderers" },
    members: [{ familyId: "f2", familyName: "The Smiths", role: "contributor", joinedAt: "2026-09-20T00:00:00Z", isYou: false }],
    invites: [],
  });
});

test("the host invites another family with a role and gets a one-time link", async () => {
  render_();
  expect(await screen.findByText("The Smiths")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Invite a family" }));
  await userEvent.click(await screen.findByRole("button", { name: "Co-owner" }));
  await userEvent.click(screen.getByRole("button", { name: "Create invite link" }));
  expect(h.createTripInvite).toHaveBeenCalledWith("t1", { role: "coowner", note: "", expiresInDays: 7 });
  expect(await screen.findByLabelText("Link", { exact: true })).toHaveValue(`${window.location.origin}/trip-invite/tok123`);
});

test("the host changes a family's role or removes it (after confirming)", async () => {
  render_();
  await userEvent.click(await screen.findByRole("button", { name: "Manage The Smiths" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Make co-owner" }));
  await waitFor(() => expect(h.setTripMemberRole).toHaveBeenCalledWith("t1", "f2", "coowner"));
  await userEvent.click(screen.getByRole("button", { name: "Manage The Smiths" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Remove from trip" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(h.removeTripMember).toHaveBeenCalledWith("t1", "f2"));
});

test("a guest family's owner can leave; members of the host family can't invite", async () => {
  h.tripMembers.mockResolvedValue({
    myRole: "contributor", host: { familyId: "f9", familyName: "The Hosts" },
    members: [{ familyId: "f1", familyName: "Us", role: "contributor", joinedAt: "2026-09-20T00:00:00Z", isYou: true }], invites: [],
  });
  render_();
  await userEvent.click(await screen.findByRole("button", { name: "Leave this trip" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Leave trip" }));
  await waitFor(() => expect(h.removeTripMember).toHaveBeenCalledWith("t1", "f1"));
  expect(screen.queryByRole("button", { name: "Invite a family" })).toBeNull();
});
