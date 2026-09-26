import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";

const { listPeople } = vi.hoisted(() => ({
  listPeople: vi.fn(async () => [
    { id: "p1", displayName: "Mom", relationship: "Family", notes: "", userId: null, avatarMediaId: null, avatarUrl: null, createdAt: "" },
  ]),
}));
const personLinks = vi.hoisted(() => vi.fn(async () => ({ incoming: [], outgoing: [], linked: [] })));
vi.mock("../api/client", () => ({ API_URL: "", api: { listPeople, personLinks } }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
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

test("link requests from another family can be confirmed from People", async () => {
  personLinks.mockResolvedValueOnce({
    incoming: [{ id: "l1", status: "pending", createdAt: "", incoming: true, person: { id: "p1", displayName: "Mom" }, other: { id: "x", displayName: "Rose", familyName: "The Smiths" } }],
    outgoing: [], linked: [],
  } as never);
  render(withQC(<PeoplePage />));
  expect(await screen.findByRole("region", { name: "Link requests" })).toHaveTextContent("The Smiths say their Rose is your Mom.");
  expect(screen.getByRole("button", { name: "Same person" })).toBeInTheDocument();
});
