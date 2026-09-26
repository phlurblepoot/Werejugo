import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  downloadBackup: vi.fn(async () => new Blob(["x"])),
  restoreBackup: vi.fn(async () => ({ ok: true, counts: { trips: 2 } })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
const auth = vi.hoisted(() => ({ user: { role: "owner", isInstanceOwner: true } as Record<string, unknown>, logout: vi.fn() }));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { SettingsPage } from "./SettingsPage";

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
  auth.user = { role: "owner", isInstanceOwner: false };
  try {
    render(<SettingsPage />);
    expect(screen.queryByText(/Download backup/)).toBeNull();
    expect(screen.queryByLabelText(/restore archive/i)).toBeNull();
    expect(screen.getByText(/managed by the server owner/i)).toBeInTheDocument();
  } finally {
    auth.user = { role: "owner", isInstanceOwner: true };
  }
});
