import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const h = vi.hoisted(() => ({
  getPerson: vi.fn(),
  acceptPersonLink: vi.fn(async () => ({ ok: true })),
  removePersonLink: vi.fn(async () => undefined),
  proposePersonLink: vi.fn(async () => ({ id: "l9", status: "pending" })),
  searchEntities: vi.fn(async () => [
    { type: "person", id: "own", label: "Dad", thumbUrl: null, familyName: null },
    { type: "person", id: "rose", label: "Rose (The Smiths)", thumbUrl: null, familyName: "The Smiths" },
  ]),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("../Toast", () => ({ useToast: () => ({ toast }) }));
import { PersonLinks } from "./PersonLinks";

beforeEach(() => vi.clearAllMocks());

test("shows linked and waiting people, and confirms an incoming one", async () => {
  h.getPerson.mockResolvedValue({
    id: "p1", displayName: "Grandma", links: [
      { linkId: "a", status: "accepted", personId: "x", displayName: "Rose", familyName: "The Smiths", incoming: false },
      { linkId: "b", status: "pending", personId: "y", displayName: "Nana", familyName: "The Does", incoming: true },
    ],
  });
  render(withQC(<PersonLinks personId="p1" personName="Grandma" />));
  expect(await screen.findByText("Rose · The Smiths")).toBeInTheDocument();
  expect(screen.getByText("Linked")).toBeInTheDocument();
  expect(screen.getByText("The Does say this is the same person")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(h.acceptPersonLink).toHaveBeenCalledWith("b"));
});

test("proposes a link only to someone in another family", async () => {
  h.getPerson.mockResolvedValue({ id: "p1", displayName: "Grandma", links: [] });
  render(withQC(<PersonLinks personId="p1" personName="Grandma" />));
  await userEvent.type(screen.getByPlaceholderText("Find them in another family…"), "o");
  await userEvent.click(await screen.findByText("Dad"));
  expect(h.proposePersonLink).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/another family/), "error");
  await userEvent.type(screen.getByPlaceholderText("Find them in another family…"), "s");
  await userEvent.click(await screen.findByText("Rose (The Smiths)"));
  await waitFor(() => expect(h.proposePersonLink).toHaveBeenCalledWith("p1", "rose"));
});
