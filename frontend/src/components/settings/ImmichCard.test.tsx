import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";

const h = vi.hoisted(() => ({ immichStatus: vi.fn(), setImmichPassword: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
const auth = vi.hoisted(() => ({ user: { role: "owner", isAdmin: false } as Record<string, unknown> }));
vi.mock("../../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { ImmichCard } from "./ImmichCard";

const renderCard = () => render(withQC(<MemoryRouter><ImmichCard /></MemoryRouter>));
const OWNER_VIEW = { enabled: true, state: "created", url: "http://10.0.0.5:2283", email: "the-smiths-a1b2c3@werejugo.local", mode: "created", canSetPassword: true };
beforeEach(() => { vi.clearAllMocks(); auth.user = { role: "owner", isAdmin: false }; });

test("an owner sees the Immich login and can set its password (checked twice, at least 8 characters)", async () => {
  h.immichStatus.mockResolvedValue(OWNER_VIEW);
  renderCard();
  expect(await screen.findByText("the-smiths-a1b2c3@werejugo.local")).toBeInTheDocument();
  expect(screen.getByText("http://10.0.0.5:2283")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Set Immich password" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("New Immich password"), "short");
  await userEvent.type(within(dialog).getByLabelText("Type it again"), "short");
  await userEvent.click(within(dialog).getByRole("button", { name: "Set password" }));
  expect(within(dialog).getByText("Use at least 8 characters")).toBeInTheDocument();
  await userEvent.clear(within(dialog).getByLabelText("New Immich password"));
  await userEvent.type(within(dialog).getByLabelText("New Immich password"), "family-photos");
  await userEvent.clear(within(dialog).getByLabelText("Type it again"));
  await userEvent.type(within(dialog).getByLabelText("Type it again"), "family-photoz");
  await userEvent.click(within(dialog).getByRole("button", { name: "Set password" }));
  expect(within(dialog).getByText("The two passwords don't match")).toBeInTheDocument();
  await userEvent.clear(within(dialog).getByLabelText("Type it again"));
  await userEvent.type(within(dialog).getByLabelText("Type it again"), "family-photos");
  await userEvent.click(within(dialog).getByRole("button", { name: "Set password" }));
  await waitFor(() => expect(h.setImmichPassword).toHaveBeenCalledWith("family-photos"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a member sees only that photos are connected", async () => {
  auth.user = { role: "member", isAdmin: false };
  h.immichStatus.mockResolvedValue({ enabled: true, state: "created" });
  renderCard();
  expect(await screen.findByText(/owners can see the Immich login/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Set Immich password" })).toBeNull();
});

test("not connected: members are told the admin connects them; the admin gets a link", async () => {
  h.immichStatus.mockResolvedValue({ enabled: false, state: "none" });
  renderCard();
  expect(await screen.findByText(/The server admin connects families to Immich/)).toBeInTheDocument();
  auth.user = { role: "owner", isAdmin: true };
  renderCard();
  expect((await screen.findAllByRole("link", { name: "Admin → Immich" }))[0]).toHaveAttribute("href", "/admin?tab=immich");
});

test("a linked account's password is changed in Immich, not here", async () => {
  h.immichStatus.mockResolvedValue({ ...OWNER_VIEW, mode: "linked", canSetPassword: false });
  renderCard();
  expect(await screen.findByText(/change its password in Immich/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Set Immich password" })).toBeNull();
});
