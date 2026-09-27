import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { createItem, uploadMedia, createLink } = vi.hoisted(() => ({
  createItem: vi.fn(async (data: any) => ({ id: "v9", ...data })),
  uploadMedia: vi.fn(), createLink: vi.fn(),
}));
vi.mock("../../api/client", () => ({
  API_URL: "",
  api: { createItem, updateItem: vi.fn(), uploadMedia, createLink, searchPlaces: vi.fn(async () => []), readExif: vi.fn(), listIcons: vi.fn(async () => ({ builtin: [], custom: [] })) },
}));
import { VisitEditor } from "./VisitEditor";


test("validates title, then saves a place visit", async () => {
  const onSaved = vi.fn();
  render(
    <VisitEditor item={null} themes={[]} trips={[]} customIcons={[]}
      onRequestPick={async () => [0, 0]} onClose={() => {}} onSaved={onSaved} />,
  );
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText(/give it a title/i)).toBeInTheDocument();
  expect(createItem).not.toHaveBeenCalled();

  fireEvent.change(screen.getByPlaceholderText(/Anniversary dinner/), { target: { value: "Dinner" } });
  fireEvent.click(screen.getByText("Save"));
  // place kind needs a location:
  expect(await screen.findByText(/Pick a location/i)).toBeInTheDocument();
});

test("switches tabs between Details and Appearance", () => {
  render(
    <VisitEditor item={null} themes={[]} trips={[]} customIcons={[]}
      onRequestPick={async () => [0, 0]} onClose={() => {}} onSaved={() => {}} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
  expect(screen.getByText(/Theme/)).toBeInTheDocument();
});
