import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
import type { ImmichAdmin } from "../../api/client";

const base = (over: Partial<ImmichAdmin> = {}): ImmichAdmin => ({
  encryptionReady: true, encryptionProblem: null, configured: false, url: null, adminKeySet: false, updatedAt: null,
  check: null, supportedRange: "3.2 or newer, before 4.0", families: [], ...over,
});
const connected = (over: Partial<ImmichAdmin> = {}) => base({
  configured: true, url: "http://10.0.0.5:2283", adminKeySet: true,
  check: { ok: true, version: "3.2.2", supported: true, error: null, at: new Date().toISOString() },
  families: [
    { id: "f1", name: "The Wanderers", state: "created", mode: "created", immichEmail: "the-wanderers-a1b2c3@werejugo.local", lastError: null, lastOkAt: null },
    { id: "f2", name: "The Smiths", state: "none", mode: null, immichEmail: null, lastError: null, lastOkAt: null },
    { id: "f3", name: "The Does", state: "error", mode: "created", immichEmail: "the-does-d4e5f6@werejugo.local", lastError: "Immich no longer accepts the family's key. Use Retry to give it a new one.", lastOkAt: null },
  ],
  ...over,
});
const h = vi.hoisted(() => ({
  immichAdmin: vi.fn(),
  saveImmichServer: vi.fn(),
  checkImmich: vi.fn(),
  connectImmichFamily: vi.fn(),
  linkImmichFamily: vi.fn(),
  disconnectImmichFamily: vi.fn(),
  connectAllImmich: vi.fn(),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("../Toast", () => ({ useToast: () => ({ toast }) }));
import { ImmichTab } from "./ImmichTab";
import { ConfirmProvider } from "../kit";

const renderTab = () => render(withQC(<MemoryRouter><ConfirmProvider><ImmichTab /></ConfirmProvider></MemoryRouter>));
beforeEach(() => { vi.clearAllMocks(); });

test("not set up: the admin enters the address and key; they're checked, and the key field empties", async () => {
  h.immichAdmin.mockResolvedValue(base());
  h.saveImmichServer.mockResolvedValue(connected());
  renderTab();
  await userEvent.type(await screen.findByLabelText("Immich address"), "http://10.0.0.5:2283");
  await userEvent.type(screen.getByLabelText("Immich admin API key"), "secret-key");
  await userEvent.click(screen.getByRole("button", { name: /Test & save/ }));
  expect(h.saveImmichServer).toHaveBeenCalledWith("http://10.0.0.5:2283", "secret-key");
  expect(await screen.findByText(/Connected to Immich 3.2.2/)).toBeInTheDocument();
  expect(screen.getByLabelText("Immich admin API key")).toHaveValue("");
  expect(screen.getByPlaceholderText(/saved/)).toBeInTheDocument();
  expect(screen.getByText("Families in Immich")).toBeInTheDocument();
});

test("a rejected key shows Immich's reason", async () => {
  h.immichAdmin.mockResolvedValue(base());
  h.saveImmichServer.mockRejectedValue(new Error("Immich rejected the API key (it may have been deleted or mistyped)"));
  renderTab();
  await userEvent.type(await screen.findByLabelText("Immich address"), "http://10.0.0.5:2283");
  await userEvent.type(screen.getByLabelText("Immich admin API key"), "bad");
  await userEvent.click(screen.getByRole("button", { name: /Test & save/ }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/rejected the API key/), "error"));
});

test("without ENCRYPTION_KEY the page explains and won't save", async () => {
  h.immichAdmin.mockResolvedValue(base({ encryptionReady: false, encryptionProblem: "ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32" }));
  renderTab();
  expect(await screen.findByRole("alert")).toHaveTextContent(/Set ENCRYPTION_KEY first/);
  expect(screen.getByRole("button", { name: /Test & save/ })).toBeDisabled();
});

test("an unsupported or unreachable Immich is called out", async () => {
  h.immichAdmin.mockResolvedValue(connected({ check: { ok: true, version: "4.0.1", supported: false, error: null, at: new Date().toISOString() } }));
  renderTab();
  expect(await screen.findByText(/not a supported version \(Werejugo supports 3.2 or newer, before 4.0\)/)).toBeInTheDocument();
});

test("families: state chips, connect, retry, connect all, link and disconnect", async () => {
  h.immichAdmin.mockResolvedValue(connected());
  renderTab();
  const rows = await screen.findAllByRole("listitem");
  const row = (name: string) => rows.find((r) => within(r).queryByText(name))!;
  expect(within(row("The Wanderers")).getByText("Connected")).toBeInTheDocument();
  expect(within(row("The Wanderers")).getByText("the-wanderers-a1b2c3@werejugo.local")).toBeInTheDocument();
  expect(within(row("The Smiths")).getByText("Not connected")).toBeInTheDocument();
  expect(within(row("The Does")).getByText("Needs attention")).toBeInTheDocument();
  expect(within(row("The Does")).getByText(/Use Retry/)).toBeInTheDocument();

  h.connectImmichFamily.mockResolvedValue(connected());
  await userEvent.click(within(row("The Smiths")).getByRole("button", { name: "Connect" }));
  expect(h.connectImmichFamily).toHaveBeenCalledWith("f2");
  await userEvent.click(within(row("The Does")).getByRole("button", { name: "Retry" }));
  expect(h.connectImmichFamily).toHaveBeenCalledWith("f3");

  h.connectAllImmich.mockResolvedValue({ ...connected(), results: [{ id: "f2", name: "The Smiths", ok: true }, { id: "f3", name: "The Does", ok: false, error: "x" }] });
  await userEvent.click(screen.getByRole("button", { name: "Connect all families" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("1 connected, 1 need attention", "success"));

  // Link an existing account.
  h.linkImmichFamily.mockResolvedValue(connected());
  await userEvent.click(within(row("The Smiths")).getByRole("button", { name: "Immich options for The Smiths" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: /Link an existing Immich account/ }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("The account's API key"), "their-key");
  await userEvent.click(within(dialog).getByRole("button", { name: "Link account" }));
  expect(h.linkImmichFamily).toHaveBeenCalledWith("f2", "their-key");

  // Disconnect asks first and says the photos stay in Immich.
  h.disconnectImmichFamily.mockResolvedValue(connected());
  await userEvent.click(within(row("The Wanderers")).getByRole("button", { name: "Immich options for The Wanderers" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: /Disconnect/ }));
  const confirm = await screen.findByRole("dialog");
  expect(confirm).toHaveTextContent(/photos stay in Immich/);
  await userEvent.click(within(confirm).getByRole("button", { name: "Disconnect" }));
  expect(h.disconnectImmichFamily).toHaveBeenCalledWith("f1");
});
