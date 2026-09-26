import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({ invitePreview: vi.fn() }));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
const auth = vi.hoisted(() => ({
  user: null as null | { displayName: string },
  acceptInvite: vi.fn(async () => {}),
  logout: vi.fn(),
}));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
import { InvitePage } from "./InvitePage";

const FAMILY = { kind: "family", familyName: null, role: "owner", invitedBy: "Sam", expiresAt: "2026-10-03T12:00:00Z", adminName: "Sam" };
const MEMBER = { kind: "member", familyName: "The Smiths", role: "member", invitedBy: "Jo", expiresAt: "2026-10-03T12:00:00Z", adminName: "Sam" };

function renderAt(token = "tok") {
  render(withQC(
    <MemoryRouter initialEntries={[`/invite/${token}`]}>
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  ));
}

beforeEach(() => {
  auth.user = null;
  h.invitePreview.mockReset();
  auth.acceptInvite.mockClear();
});

test("a new-family invite asks for the family name and says the admin can see everything", async () => {
  h.invitePreview.mockResolvedValue(FAMILY);
  renderAt("abc");
  expect(await screen.findByText("Start your family on Werejugo")).toBeInTheDocument();
  expect(screen.getByText(/can see and manage all data on it/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Your name"), "Alex");
  await userEvent.type(screen.getByLabelText(/Family name/), "The Garcias");
  await userEvent.type(screen.getByLabelText("Email"), "alex@test.dev");
  await userEvent.type(screen.getByLabelText(/Password/), "long-enough");
  await userEvent.click(screen.getByRole("button", { name: "Create my family" }));
  expect(auth.acceptInvite).toHaveBeenCalledWith("abc", { displayName: "Alex", familyName: "The Garcias", email: "alex@test.dev", password: "long-enough" });
  expect(await screen.findByText("home")).toBeInTheDocument();
});

test("a member invite joins an existing family, without a family name or notice", async () => {
  h.invitePreview.mockResolvedValue(MEMBER);
  renderAt();
  expect(await screen.findByText("Join The Smiths")).toBeInTheDocument();
  expect(screen.queryByLabelText(/Family name/)).toBeNull();
  expect(screen.queryByText(/can see and manage all data/)).toBeNull();
  expect(screen.getByRole("button", { name: "Join family" })).toBeInTheDocument();
});

test("an expired or used invite explains itself", async () => {
  h.invitePreview.mockRejectedValue(new Error("gone"));
  renderAt();
  expect(await screen.findByText("Invite not valid")).toBeInTheDocument();
});

test("someone already signed in is asked to sign out first", async () => {
  h.invitePreview.mockResolvedValue(MEMBER);
  auth.user = { displayName: "Pat" };
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(auth.logout).toHaveBeenCalled();
});
