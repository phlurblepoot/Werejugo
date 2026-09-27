import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { createItem, updateItem, createLink } = vi.hoisted(() => ({
  createItem: vi.fn(async (data: any) => ({ id: "v9", ...data })),
  updateItem: vi.fn(async (id: string, data: any) => ({ id, ...data })),
  createLink: vi.fn(),
}));
vi.mock("../../api/client", () => ({
  API_URL: "",
  api: { createItem, updateItem, createLink, searchPlaces: vi.fn(async () => []), readExif: vi.fn(), listIcons: vi.fn(async () => ({ builtin: [], custom: [] })) },
}));
import { VisitEditor } from "./VisitEditor";
import { fakeUploads, withUploads } from "../../test/uploads";


test("validates title, then saves a place visit", async () => {
  const onSaved = vi.fn();
  render(withUploads(
    <VisitEditor item={null} themes={[]} trips={[]} customIcons={[]}
      onRequestPick={async () => [0, 0]} onClose={() => {}} onSaved={onSaved} />,
  ));
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText(/give it a title/i)).toBeInTheDocument();
  expect(createItem).not.toHaveBeenCalled();

  fireEvent.change(screen.getByPlaceholderText(/Anniversary dinner/), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByText("Save"));
  // place kind needs a location:
  expect(await screen.findByText(/Pick a location/i)).toBeInTheDocument();
});

test("switches tabs between Details and Appearance", () => {
  render(withUploads(
    <VisitEditor item={null} themes={[]} trips={[]} customIcons={[]}
      onRequestPick={async () => [0, 0]} onClose={() => {}} onSaved={() => {}} />,
  ));
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
  expect(screen.getByText(/Theme/)).toBeInTheDocument();
});

test("photos added before saving upload in the background, linked to the new place, without holding the editor open", async () => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  const { manager, transport } = fakeUploads();
  const onSaved = vi.fn();
  render(withUploads(
    <VisitEditor item={null} themes={[]} trips={[]} customIcons={[]}
      onRequestPick={async () => [12.5, 41.9]} onClose={() => {}} onSaved={onSaved} />,
    manager,
  ));
  fireEvent.change(screen.getByPlaceholderText(/Anniversary dinner/), { target: { value: "Rome" } });
  fireEvent.click(screen.getByText(/Pick on map/));
  await screen.findByText(/41\.9000, 12\.5000/);
  fireEvent.change(screen.getByTestId("visit-photo-input"), { target: { files: [new File(["x"], "forum.jpg", { type: "image/jpeg" })] } });
  fireEvent.click(screen.getByText("Save"));

  await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(createLink).not.toHaveBeenCalled(); // the server links it
  await vi.waitFor(() => expect(transport.create).toHaveBeenCalledWith(expect.objectContaining({ filename: "forum.jpg", linkTo: "visit:v9", linkRole: "appears_in" })));
  await vi.waitFor(() => expect(manager.snapshot()[0].state).toBe("done"));
});

test("saving again after a failed save sends the same key (one place, not two); after it's made, saves update it", async () => {
  createItem.mockClear();
  createItem.mockRejectedValueOnce(new Error("Network error"));
  render(withUploads(
    <VisitEditor item={null} themes={[]} trips={[]} customIcons={[]}
      onRequestPick={async () => [12.5, 41.9]} onClose={() => {}} onSaved={() => {}} />,
  ));
  fireEvent.change(screen.getByPlaceholderText(/Anniversary dinner/), { target: { value: "Rome" } });
  fireEvent.click(screen.getByText(/Pick on map/));
  await waitFor(() => expect(screen.getByText(/41\.9000, 12\.5000/)).toBeInTheDocument());
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText("Network error")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(createItem).toHaveBeenCalledTimes(2));
  const [first, second] = createItem.mock.calls.map((c) => c[0].clientKey);
  expect(first).toMatch(/^[0-9a-f-]{36}$/);
  expect(second).toBe(first);
  // Made: another save updates it.
  fireEvent.click(await screen.findByText("Save"));
  await waitFor(() => expect(updateItem).toHaveBeenCalledWith("v9", expect.objectContaining({ title: "Rome" })));
  expect(createItem).toHaveBeenCalledTimes(2);
});

test("picking on the map can be cancelled: the editor comes back as it was", async () => {
  let cancel!: () => void;
  const onRequestPick = () => new Promise<[number, number] | null>((resolve) => { cancel = () => resolve(null); });
  render(withUploads(
    <VisitEditor item={null} themes={[]} trips={[]} customIcons={[]}
      onRequestPick={onRequestPick} onCancelPick={() => cancel()} onClose={() => {}} onSaved={() => {}} />,
  ));
  fireEvent.change(screen.getByPlaceholderText(/Anniversary dinner/), { target: { value: "Kept" } });
  fireEvent.click(screen.getByText(/Pick on map/));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(await screen.findByDisplayValue("Kept")).toBeInTheDocument();
  expect(screen.getByText("No location set")).toBeInTheDocument();
});
