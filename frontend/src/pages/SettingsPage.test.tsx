import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  downloadBackup: vi.fn(async () => new Blob(["x"])),
  restoreBackup: vi.fn(async () => ({ ok: true, counts: { trips: 2 } })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { role: "owner" } }) }));
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
