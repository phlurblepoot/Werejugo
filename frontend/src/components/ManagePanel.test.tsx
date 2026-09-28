import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  updateTheme: vi.fn(async () => ({})), deleteTheme: vi.fn(), createTheme: vi.fn(), uploadIcon: vi.fn(), deleteIcon: vi.fn(),
  listIcons: vi.fn(async () => ({ builtin: [], custom: [] })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { ManagePanel } from "./ManagePanel";

const beach = { id: "th1", name: "Beach", kind: "place", icon: "umbrella", color: "#ffaa00", lineColor: "#ffaa00", lineWidth: 3, isBuiltin: false };

test("a theme of mine can be edited: its name, look and trail colour", async () => {
  const onChanged = vi.fn();
  render(<ManagePanel themes={[beach]} customIcons={[]} onClose={() => {}} onChanged={onChanged} />);
  await userEvent.click(screen.getByRole("button", { name: "Edit Beach" }));
  const name = screen.getByLabelText("Name", { selector: "#theme-name-th1" });
  await userEvent.clear(name);
  await userEvent.type(name, "Beach days");
  await userEvent.click(screen.getByRole("button", { name: "Save theme" }));
  await waitFor(() => expect(h.updateTheme).toHaveBeenCalledWith("th1", { name: "Beach days", color: "#ffaa00", icon: "umbrella", lineColor: "#ffaa00" }));
  expect(onChanged).toHaveBeenCalled();
});
