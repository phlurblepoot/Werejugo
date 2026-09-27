import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import type { Face } from "../../api/client";
import { withQC } from "../../test/qc";

const face = (o: Partial<Face> & { id: string }): Face => ({
  name: "", thumbUrl: `/api/f/${o.id}?e=1&s=x`, photoCount: 3, ignored: false, hiddenInImmich: false,
  firstSeenAt: "2026-09-01T00:00:00Z", person: null, ...o,
});
const h = vi.hoisted(() => ({
  listFaces: vi.fn(),
  facesCount: vi.fn(async () => ({ review: 2 })),
  listPeople: vi.fn(async () => [
    { id: "zoe", displayName: "Zoe", avatarUrl: null },
    { id: "mia", displayName: "Mia", avatarUrl: null },
  ]),
  searchEntities: vi.fn(async (): Promise<unknown[]> => []),
  updateFace: vi.fn(async () => ({ face: {}, tagged: 124, untagged: 0 })),
  personFromFace: vi.fn(async () => ({ face: {}, personId: "new", tagged: 7 })),
  personFaces: vi.fn(async (): Promise<Face[]> => []),
  mediaTimeline: vi.fn(async () => ({ months: [] as Array<{ month: string; count: number }>, total: 0 })),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("../Toast", () => ({ useToast: () => ({ toast }) }));
import { FacesView } from "./FacesView";
import { FaceAssign } from "./FaceAssign";
import { PersonFaces } from "./PersonFaces";

beforeEach(() => {
  vi.clearAllMocks();
  h.listFaces.mockImplementation(async (view: string) => view === "review"
    ? [face({ id: "f1", photoCount: 12 }), face({ id: "f2", name: "Uncle Bob", photoCount: 4 })]
    : view === "mapped" ? [face({ id: "f3", person: { id: "g", displayName: "Grandma Rose", familyName: "The Smiths" } })] : []);
});

test("faces to review, with the count; matched ones show who they are and whose person", async () => {
  render(withQC(<FacesView />));
  const grid = await screen.findByRole("list", { name: "Faces to review" });
  expect(within(grid).getAllByRole("button").map((b) => b.textContent)).toEqual(["Who is this?12 photos", "Uncle Bob4 photos"]);
  expect(screen.getByRole("button", { name: "To review (2)" })).toHaveAttribute("aria-pressed", "true");

  await userEvent.click(screen.getByRole("button", { name: "Matched" }));
  const matched = await screen.findByRole("list", { name: "Matched faces" });
  expect(within(matched).getByText("Grandma Rose")).toBeInTheDocument();
  expect(within(matched).getByText("The Smiths")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Ignored" }));
  expect(await screen.findByText("Nothing ignored")).toBeInTheDocument();
  expect(h.listFaces).toHaveBeenCalledWith("ignored");
});

test("who is this: one of ours, tagged at once", async () => {
  render(withQC(<FaceAssign face={face({ id: "f1" })} onClose={() => {}} />));
  const people = await screen.findByRole("list", { name: "People" });
  await waitFor(() => expect(within(people).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["MMia", "ZZoe"])); // initial + name
  await userEvent.type(screen.getByLabelText("Search people"), "zo");
  await waitFor(() => expect(within(people).getAllByRole("button")).toHaveLength(1));
  await userEvent.click(within(people).getByRole("button", { name: /Zoe/ }));
  await waitFor(() => expect(h.updateFace).toHaveBeenCalledWith("f1", { personId: "zoe" }));
  expect(toast).toHaveBeenCalledWith("Zoe: tagged in 124 photos", "success");
});

test("who is this: another family's person, found by searching and marked with their family", async () => {
  h.searchEntities.mockResolvedValue([
    { type: "person", id: "mia", label: "Mia", thumbUrl: null, familyName: null },
    { type: "person", id: "rose", label: "Rose (The Smiths)", thumbUrl: null, familyName: "The Smiths" },
  ]);
  render(withQC(<FaceAssign face={face({ id: "f1" })} onClose={() => {}} />));
  await userEvent.type(screen.getByLabelText("Search people"), "r");
  const rose = await screen.findByRole("button", { name: /Rose/ });
  expect(rose.querySelector(".er-main")?.textContent).toBe("Rose The Smiths");
  expect(screen.queryAllByRole("button", { name: /^Mia/ })).toHaveLength(0); // ours come from our list, not twice
  await userEvent.click(rose);
  await waitFor(() => expect(h.updateFace).toHaveBeenCalledWith("f1", { personId: "rose" }));
});

test("who is this: a new person (Immich's name filled in), or nobody we keep", async () => {
  const onClose = vi.fn();
  const { unmount } = render(withQC(<FaceAssign face={face({ id: "f2", name: "Uncle Bob" })} onClose={onClose} />));
  expect(screen.getByText("Named “Uncle Bob” in Immich")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "New person “Uncle Bob”" }));
  await waitFor(() => expect(h.personFromFace).toHaveBeenCalledWith("f2", "Uncle Bob"));
  expect(toast).toHaveBeenCalledWith("Added Uncle Bob, tagged in 7 photos", "success");
  expect(onClose).toHaveBeenCalled();
  unmount();

  render(withQC(<FaceAssign face={face({ id: "f1" })} onClose={() => {}} />));
  expect(screen.getByRole("button", { name: "New person" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Not someone we keep" }));
  await waitFor(() => expect(h.updateFace).toHaveBeenCalledWith("f1", { ignored: true }));
});

test("a matched face can be unmatched", async () => {
  h.updateFace.mockResolvedValueOnce({ face: {}, tagged: 0, untagged: 5 });
  render(withQC(<FaceAssign face={face({ id: "f3", person: { id: "mia", displayName: "Mia", familyName: null } })} onClose={() => {}} />));
  expect(screen.getByText("Mia", { selector: "strong" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Not someone we keep" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Unmatch" }));
  await waitFor(() => expect(h.updateFace).toHaveBeenCalledWith("f3", { personId: null }));
  expect(toast).toHaveBeenCalledWith("Unmatched: 5 photos untagged", "success");
});

test("a person's page: their faces and a link to their photos", async () => {
  h.personFaces.mockResolvedValue([face({ id: "f3" }), face({ id: "f4", photoCount: 1 })]);
  h.mediaTimeline.mockResolvedValue({ months: [{ month: "2025-07", count: 31 }], total: 31 });
  render(withQC(<MemoryRouter><PersonFaces personId="mia" personName="Mia" /></MemoryRouter>));
  expect(await screen.findByRole("link", { name: "See 31 photos" })).toHaveAttribute("href", "/photos?person=mia");
  expect(screen.getByText("Found in photos by 2 faces:")).toBeInTheDocument();
  expect(h.mediaTimeline).toHaveBeenCalledWith({ person: "mia" });
  await userEvent.click(screen.getByRole("button", { name: "Face in 1 photos" }));
  expect(await screen.findByRole("dialog", { name: "Who is this?" })).toBeInTheDocument();
});

test("a person with no photos says so", async () => {
  render(withQC(<MemoryRouter><PersonFaces personId="zoe" personName="Zoe" /></MemoryRouter>));
  expect(await screen.findByText("No photos of Zoe yet.")).toBeInTheDocument();
});
