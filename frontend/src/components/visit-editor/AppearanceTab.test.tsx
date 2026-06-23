import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "", api: { listIcons: vi.fn(async () => ({ builtin: [], custom: [] })) } }));
import { AppearanceTab } from "./AppearanceTab";
import type { VisitDraft } from "./useVisitDraft";

const baseDraft = {
  kind: "place", themeId: null, color: "#2563eb", icon: "pin",
  pin: { size: 28, shape: "circle", borderWidth: 2, borderColor: "#fff" },
  path: { style: "solid", color: "#2563eb", width: 3 },
} as unknown as VisitDraft;

test("shows the theme select; hides the trail controls for point kinds", () => {
  render(<AppearanceTab draft={baseDraft} set={() => {}} applyTheme={() => {}} themes={[]} customIcons={[]} />);
  expect(screen.getByText(/Theme/)).toBeInTheDocument();
  expect(screen.queryByText(/Trail \(path line\)/)).not.toBeInTheDocument();
});

test("shows the trail controls for route kinds", () => {
  render(<AppearanceTab draft={{ ...baseDraft, kind: "drive" } as VisitDraft} set={() => {}} applyTheme={() => {}} themes={[]} customIcons={[]} />);
  expect(screen.getByText(/Trail \(path line\)/)).toBeInTheDocument();
});
