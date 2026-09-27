import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({
  getFamily: vi.fn(),
  updateAccount: vi.fn(async () => ({})),
  changePassword: vi.fn(async () => ({ token: "new-token" })),
  signOutEverywhere: vi.fn(async () => ({ ok: true })),
  createMemberInvite: vi.fn(async () => ({ id: "i1", token: "t", path: "/invite/secret-token", expiresAt: "2026-10-03T12:00:00Z" })),
  removeMember: vi.fn(async () => undefined),
  memberResetLink: vi.fn(async () => ({ id: "r1", token: "t", path: "/reset/reset-token", expiresAt: "2026-09-29T12:00:00Z" })),
  setMemberRole: vi.fn(async () => ({ ok: true })),
  revokeMemberInvite: vi.fn(async () => undefined),
  renameFamily: vi.fn(async () => ({ ok: true })),
  downloadLink: vi.fn(async () => "/api/family/export?ticket=abc"),
  immichStatus: vi.fn(async () => ({ enabled: false, state: "none" })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
const OWNER = { id: "u1", familyId: "f1", role: "owner", isAdmin: false, displayName: "Pat", email: "pat@test.dev", color: "#0f766e" };
const auth = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  family: { id: "f1", name: "The Wanderers" },
  adminView: null,
  refresh: vi.fn(async () => {}),
  adoptToken: vi.fn(async () => {}),
  logout: vi.fn(),
}));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { SettingsPage } from "./SettingsPage";
import { ThemeProvider } from "../lib/theme";
import { ConfirmProvider } from "../components/kit";

const member = (over: Record<string, unknown>) => ({
  id: "m", displayName: "Someone", email: "x@test.dev", role: "member", color: "#b45309", isAdmin: false,
  lastLoginAt: null, joinedAt: "2026-01-01T00:00:00Z", isYou: false, ...over,
});

function renderPage() {
  render(withQC(
    <MemoryRouter>
      <ThemeProvider><ConfirmProvider><SettingsPage /></ConfirmProvider></ThemeProvider>
    </MemoryRouter>,
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { ...OWNER };
  h.getFamily.mockResolvedValue({
    family: { id: "f1", name: "The Wanderers", createdAt: "2026-01-01T00:00:00Z" },
    members: [
      member({ id: "u1", displayName: "Pat", email: "pat@test.dev", role: "owner", isYou: true }),
      member({ id: "u2", displayName: "Kid", email: "kid@test.dev" }),
    ],
    invites: [{ id: "i9", role: "member", note: "Grandma", createdAt: "2026-09-20T00:00:00Z", expiresAt: "2026-09-30T00:00:00Z", createdByName: "Pat" }],
  });
});

test("saves your name and colour", async () => {
  renderPage();
  const name = screen.getByLabelText("Your name");
  await userEvent.clear(name);
  await userEvent.type(name, "Patricia");
  await userEvent.click(screen.getByRole("button", { name: "Colour #b45309" }));
  await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(h.updateAccount).toHaveBeenCalledWith({ displayName: "Patricia", color: "#b45309" });
  await waitFor(() => expect(auth.refresh).toHaveBeenCalled());
});

test("changing the password adopts the new session token", async () => {
  renderPage();
  await userEvent.type(screen.getByLabelText("Current password"), "old-password");
  await userEvent.type(screen.getByLabelText("New password"), "new-password");
  await userEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(h.changePassword).toHaveBeenCalledWith("old-password", "new-password");
  await waitFor(() => expect(auth.adoptToken).toHaveBeenCalledWith("new-token"));
});

test("sign out everywhere asks first, then signs this device out too", async () => {
  renderPage();
  await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Sign out everywhere" }));
  await waitFor(() => expect(auth.logout).toHaveBeenCalled());
  expect(h.signOutEverywhere).toHaveBeenCalled();
});

test("owners create a one-time invite link to copy", async () => {
  renderPage();
  expect(await screen.findByText("Kid")).toBeInTheDocument();
  expect(screen.getByText("Grandma")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Invite" }));
  await userEvent.click(await screen.findByRole("button", { name: "Owner" }));
  await userEvent.type(screen.getByLabelText(/Who is it for/), "Uncle Bob");
  await userEvent.click(screen.getByRole("button", { name: "Create invite link" }));
  expect(h.createMemberInvite).toHaveBeenCalledWith({ role: "owner", note: "Uncle Bob", expiresInDays: 7 });
  expect(await screen.findByLabelText("Link")).toHaveValue(`${window.location.origin}/invite/secret-token`);
});

test("removing a member needs confirmation", async () => {
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Manage Kid" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Remove from family" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Remove Kid?")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(h.removeMember).toHaveBeenCalledWith("u2"));
});

test("an owner can't reset or remove the server admin", async () => {
  h.getFamily.mockResolvedValueOnce({
    family: { id: "f1", name: "The Wanderers", createdAt: "2026-01-01T00:00:00Z" },
    members: [member({ id: "u1", displayName: "Pat", role: "owner", isYou: true }), member({ id: "a1", displayName: "Admin", role: "owner", isAdmin: true })],
    invites: [],
  });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Manage Admin" }));
  expect(await screen.findByRole("menuitem", { name: "Make member" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Remove from family" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: /password reset/ })).toBeNull();
});

test("owners can download their family's data", async () => {
  renderPage();
  await userEvent.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() => expect(h.downloadLink).toHaveBeenCalledWith("family-export"));
});

test("members see who's in the family but can't manage it", async () => {
  auth.user = { ...OWNER, role: "member" };
  h.getFamily.mockResolvedValueOnce({
    family: { id: "f1", name: "The Wanderers", createdAt: "2026-01-01T00:00:00Z" },
    members: [member({ id: "u1", displayName: "Pat", isYou: true }), member({ id: "u2", displayName: "Kid" })],
    invites: [],
  });
  renderPage();
  expect(await screen.findByText("Kid")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Manage Kid" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Rename family" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
});

test("backups are no longer here; admins get a pointer to Admin", async () => {
  auth.user = { ...OWNER, isAdmin: true };
  renderPage();
  expect(screen.queryByText(/Download backup/)).toBeNull();
  expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
});

test("the theme can be switched here", async () => {
  renderPage();
  await userEvent.click(screen.getByRole("button", { name: "Dark" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  await userEvent.click(screen.getByRole("button", { name: "System" }));
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
});
