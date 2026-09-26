import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  downloadBackup: vi.fn(async () => new Blob(["x"])),
  restoreBackup: vi.fn(async () => ({ ok: true, counts: { trips: 2 } })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
const auth = vi.hoisted(() => ({
  user: { role: "owner", isInstanceOwner: true, displayName: "Pat", email: "pat@test.dev" } as Record<string, unknown>,
  family: { id: "f1", name: "The Wanderers", inviteCode: "WANDER42" },
  logout: vi.fn(),
}));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { SettingsPage } from "./SettingsPage";
import { ThemeProvider } from "../lib/theme";

beforeAll(() => {
  // jsdom lacks object URLs
  (URL as any).createObjectURL = vi.fn(() => "blob:x");
  (URL as any).revokeObjectURL = vi.fn();
});

test("downloads a backup", async () => {
  render(<SettingsPage />);
  fireEvent.click(screen.getByText(/Download backup/));
  await waitFor(() => expect(h.downloadBackup).toHaveBeenCalled());
});

test("restore stays disabled until 'restore' is typed", async () => {
  render(<SettingsPage />);
  const file = new File(["x"], "b.tar.gz");
  fireEvent.change(screen.getByLabelText(/restore archive/i), { target: { files: [file] } });
  const btn = screen.getByText(/Restore & replace/) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  fireEvent.change(screen.getByPlaceholderText("restore"), { target: { value: "restore" } });
  expect((screen.getByText(/Restore & replace/) as HTMLButtonElement).disabled).toBe(false);
});

test("only the server owner sees backup and restore", () => {
  auth.user = { role: "owner", isInstanceOwner: false, displayName: "Pat", email: "pat@test.dev" };
  try {
    render(<SettingsPage />);
    expect(screen.queryByText(/Download backup/)).toBeNull();
    expect(screen.queryByLabelText(/restore archive/i)).toBeNull();
    expect(screen.getByText(/managed by the server owner/i)).toBeInTheDocument();
  } finally {
    auth.user = { role: "owner", isInstanceOwner: true, displayName: "Pat", email: "pat@test.dev" };
  }
});

test("shows the family's invite code", () => {
  render(<SettingsPage />);
  expect(screen.getByText("WANDER42")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
});

test("the theme can be switched here", () => {
  render(<ThemeProvider><SettingsPage /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Dark" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "System" }));
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
});
