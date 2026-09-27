import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";

const { listPeople } = vi.hoisted(() => ({
  listPeople: vi.fn(async () => [
    { id: "p1", displayName: "Mom", relationship: "Family", notes: "", userId: null, avatarMediaId: null, avatarUrl: null, createdAt: "" },
  ]),
}));
const personLinks = vi.hoisted(() => vi.fn(async () => ({ incoming: [], outgoing: [], linked: [] })));
vi.mock("../api/client", () => ({ API_URL: "", api: {
  listPeople, personLinks,
  getRelations: async () => [], getPerson: async () => ({ id: "p1", displayName: "Mom", links: [] }),
  createLink: async () => ({}), deleteLink: async () => undefined, searchEntities: async () => [],
  facesCount: async () => ({ review: 3 }),
  listFaces: async () => [{ id: "f1", name: "", thumbUrl: "/api/f/f1", photoCount: 9, ignored: false, hiddenInImmich: false, firstSeenAt: "", person: null }],
  personFaces: async () => [], mediaTimeline: async () => ({ months: [], total: 0 }),
} }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { PeoplePage } from "./PeoplePage";

test("renders the family's people", async () => {
  render(withQC(<MemoryRouter><PeoplePage /></MemoryRouter>));
  expect(await screen.findByText("Mom")).toBeInTheDocument();
  expect(screen.getByText(/Family/)).toBeInTheDocument(); // rendered as " · Family"
});

test("shows an empty state when there are no people", async () => {
  listPeople.mockResolvedValueOnce([]);
  render(withQC(<MemoryRouter><PeoplePage /></MemoryRouter>));
  expect(await screen.findByText(/add your first/i)).toBeInTheDocument();
});

test("link requests from another family can be confirmed from People", async () => {
  personLinks.mockResolvedValueOnce({
    incoming: [{ id: "l1", status: "pending", createdAt: "", incoming: true, person: { id: "p1", displayName: "Mom" }, other: { id: "x", displayName: "Rose", familyName: "The Smiths" } }],
    outgoing: [], linked: [],
  } as never);
  render(withQC(<MemoryRouter><PeoplePage /></MemoryRouter>));
  expect(await screen.findByRole("region", { name: "Link requests" })).toHaveTextContent("The Smiths say their Rose is your Mom.");
  expect(screen.getByRole("button", { name: "Same person" })).toBeInTheDocument();
});

test("/people?person=<id> opens that person", async () => {
  render(withQC(<MemoryRouter initialEntries={["/people?person=p1"]}><PeoplePage /></MemoryRouter>));
  expect(await screen.findByText("Same person in another family")).toBeInTheDocument();
});

test("the Faces view: how many wait, and the faces to review", async () => {
  render(withQC(<MemoryRouter><PeoplePage /></MemoryRouter>));
  await userEvent.click(await screen.findByRole("button", { name: "Faces (3)" }));
  expect(await screen.findByRole("list", { name: "Faces to review" })).toHaveTextContent("Who is this?9 photos");
  expect(screen.queryByText("Mom")).toBeNull();
});

test("/people?view=faces opens on the faces", async () => {
  render(withQC(<MemoryRouter initialEntries={["/people?view=faces"]}><PeoplePage /></MemoryRouter>));
  expect(await screen.findByRole("list", { name: "Faces to review" })).toBeInTheDocument();
});
