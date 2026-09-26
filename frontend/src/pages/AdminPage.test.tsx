import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({
  adminOverview: vi.fn(),
  adminFamilyInvites: vi.fn(async () => []),
  adminViewFamily: vi.fn(async () => ({ token: "view-token" })),
  adminReturn: vi.fn(async () => ({ token: "home-token" })),
  adminDeleteFamily: vi.fn(async () => undefined),
  adminUpdateFamily: vi.fn(async () => ({ ok: true })),
  createFamilyInvite: vi.fn(async () => ({ id: "i1", token: "t", path: "/invite/fam-token", expiresAt: "2026-10-03T12:00:00Z" })),
  adminUsers: vi.fn(async () => []),
  adminUpdateUser: vi.fn(async () => ({ ok: true })),
  auditLog: vi.fn(async () => []),
  downloadLink: vi.fn(async () => "/api/backup?ticket=abc"),
  restoreBackup: vi.fn(async () => ({ ok: true, counts: { trips: 2 } })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
const auth = vi.hoisted(() => ({
  user: { id: "u1", familyId: "home", role: "owner", isAdmin: true, displayName: "Sam", email: "sam@test.dev" } as Record<string, unknown>,
  adminView: null,
  adoptToken: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  logout: vi.fn(),
}));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { AdminPage } from "./AdminPage";
import { ConfirmProvider } from "../components/kit";

const family = (id: string, name: string, over = {}) => ({
  id, name, createdAt: "2026-01-01T00:00:00Z", disabled: false, memberCount: 2, owners: ["Owner"], ...over,
});

function renderAt(path = "/admin") {
  render(withQC(
    <MemoryRouter initialEntries={[path]}>
      <ConfirmProvider>
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/map" element={<div>map page</div>} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>,
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { ...auth.user, isAdmin: true };
  h.adminOverview.mockResolvedValue({
    families: [family("home", "Our Family"), family("smiths", "The Smiths"), family("gone", "Snoozers", { disabled: true })],
    userCount: 6, adminCount: 1, pendingFamilyInvites: 0,
  });
});

test("lists every family; stepping into one adopts the admin-view session", async () => {
  renderAt();
  expect(await screen.findByText("The Smiths")).toBeInTheDocument();
  expect(screen.getByText(/your family/)).toBeInTheDocument();
  expect(screen.getByText("Disabled")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Manage The Smiths" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "View as this family" }));
  await waitFor(() => expect(auth.adoptToken).toHaveBeenCalledWith("view-token"));
  expect(h.adminViewFamily).toHaveBeenCalledWith("smiths");
  expect(await screen.findByText("map page")).toBeInTheDocument();
});

test("your own family can't be disabled or deleted from here", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: "Manage Our Family" }));
  expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Disable" })).toBeNull();
});

test("deleting a family needs its exact name typed", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: "Manage The Smiths" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Delete family…" }));
  const dialog = await screen.findByRole("dialog");
  const del = within(dialog).getByRole("button", { name: "Delete family" });
  expect(del).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText(/to confirm/), "the smiths");
  expect(del).toBeDisabled();
  await userEvent.clear(within(dialog).getByLabelText(/to confirm/));
  await userEvent.type(within(dialog).getByLabelText(/to confirm/), "The Smiths");
  await userEvent.click(del);
  await waitFor(() => expect(h.adminDeleteFamily).toHaveBeenCalledWith("smiths", "The Smiths"));
});

test("invites a new family with a one-time link", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: "Invite a family" }));
  await userEvent.type(await screen.findByLabelText(/Who is it for/), "The Garcias");
  await userEvent.click(screen.getByRole("button", { name: "Create invite link" }));
  expect(h.createFamilyInvite).toHaveBeenCalledWith({ note: "The Garcias", expiresInDays: 7 });
  expect(await screen.findByLabelText("Link")).toHaveValue(`${window.location.origin}/invite/fam-token`);
});

test("people: promote to admin after confirming", async () => {
  h.adminUsers.mockResolvedValue([{
    id: "u2", displayName: "Jo", email: "jo@test.dev", familyId: "smiths", familyName: "The Smiths", role: "member",
    isAdmin: false, disabled: false, lastLoginAt: null, createdAt: "2026-01-01T00:00:00Z", isYou: false,
  }] as never);
  renderAt("/admin?tab=people");
  await userEvent.click(await screen.findByRole("button", { name: "Manage Jo" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Make server admin" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/see and change everything/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Make admin" }));
  await waitFor(() => expect(h.adminUpdateUser).toHaveBeenCalledWith("u2", { isAdmin: true }));
});

test("backup and restore live here now", async () => {
  renderAt("/admin?tab=backup");
  await userEvent.click(screen.getByRole("button", { name: /Download backup/ }));
  await waitFor(() => expect(h.downloadLink).toHaveBeenCalledWith("backup"));
  await userEvent.upload(screen.getByLabelText(/restore archive/i), new File(["x"], "b.tar.gz"));
  const btn = screen.getByRole("button", { name: /Restore & replace/ });
  expect(btn).toBeDisabled();
  await userEvent.type(screen.getByPlaceholderText("restore"), "restore");
  expect(btn).toBeEnabled();
});

test("the audit log reads like sentences", async () => {
  h.auditLog.mockResolvedValue([
    { id: "2", at: "2026-09-26T10:00:00Z", actorName: "Sam", action: "admin.view_family", familyId: "smiths", familyName: "The Smiths", target: "The Smiths", details: {} },
  ] as never);
  renderAt("/admin?tab=audit");
  expect(await screen.findByText(/viewed a family as admin/)).toBeInTheDocument();
});

test("non-admins are turned away", () => {
  auth.user = { ...auth.user, isAdmin: false };
  renderAt();
  expect(screen.getByText(/Only the server admin/)).toBeInTheDocument();
  expect(h.adminOverview).not.toHaveBeenCalled();
});
