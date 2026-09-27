import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "", api: { listIcons: vi.fn(async () => ({ builtin: [], custom: [] })) } }));
import { AppearanceTab } from "./AppearanceTab";
import type { VisitDraft } from "./useVisitDraft";

const baseDraft = {
  kind: "place", themeId: null, color: "#2563eb", icon: "pin",
  pin: { size: 28, shape: "circle", borderWidth: 2, borderColor: "#fff" },
  path: { style: "solid", color: "#2563eb", width: 3 },
} as unknown as VisitDraft;
const inherited = {
  color: "#2563eb", icon: "pin", size: 28, shape: "circle", borderWidth: 2, borderColor: "#fff",
  lineColor: "#2563eb", lineWidth: 3, pathStyle: "solid", pathImageUrl: undefined,
} as never;

test("shows the theme select; hides the trail controls for point kinds", () => {
  render(<AppearanceTab draft={baseDraft} set={() => {}} applyTheme={() => {}} inherited={inherited} themes={[]} customIcons={[]} />);
  expect(screen.getByText(/Theme/)).toBeInTheDocument();
  expect(screen.queryByText(/Trail \(path line\)/)).not.toBeInTheDocument();
});

test("shows the trail controls for route kinds", () => {
  render(<AppearanceTab draft={{ ...baseDraft, kind: "drive" } as VisitDraft} set={() => {}} applyTheme={() => {}} inherited={inherited} themes={[]} customIcons={[]} />);
  expect(screen.getByText(/Trail \(path line\)/)).toBeInTheDocument();
});

test("following the defaults, or chosen for this item with a way back", async () => {
  const set = vi.fn();
  const { rerender } = render(<AppearanceTab draft={baseDraft} set={set} applyTheme={() => {}} inherited={inherited} themes={[]} customIcons={[]} />);
  expect(screen.getAllByText(/Following the defaults/)).toHaveLength(2);
  const chosen = { ...baseDraft, color: "#ff0000", pin: { ...baseDraft.pin, size: 40 } } as VisitDraft;
  rerender(<AppearanceTab draft={chosen} set={set} applyTheme={() => {}} inherited={inherited} themes={[]} customIcons={[]} />);
  const [look, pin] = screen.getAllByRole("button", { name: "Use default" });
  await userEvent.click(look);
  expect(set).toHaveBeenCalledWith({ color: "#2563eb", icon: "pin" });
  await userEvent.click(pin);
  expect(set).toHaveBeenCalledWith({ pin: { size: 28, shape: "circle", borderWidth: 2, borderColor: "#fff" } });
});
