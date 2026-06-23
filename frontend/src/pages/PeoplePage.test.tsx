import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";

const { listPeople } = vi.hoisted(() => ({
  listPeople: vi.fn(async () => [
    { id: "p1", displayName: "Mom", relationship: "Family", notes: "", userId: null, avatarMediaId: null, avatarUrl: null, createdAt: "" },
  ]),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: { listPeople } }));
import { PeoplePage } from "./PeoplePage";

test("renders the family's people", async () => {
  render(withQC(<PeoplePage />));
  expect(await screen.findByText("Mom")).toBeInTheDocument();
  expect(screen.getByText(/Family/)).toBeInTheDocument(); // rendered as " · Family"
});

test("shows an empty state when there are no people", async () => {
  listPeople.mockResolvedValueOnce([]);
  render(withQC(<PeoplePage />));
  expect(await screen.findByText(/add your first/i)).toBeInTheDocument();
});
