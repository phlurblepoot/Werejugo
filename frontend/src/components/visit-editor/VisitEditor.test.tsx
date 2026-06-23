import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { createItem, uploadMedia, createLink } = vi.hoisted(() => ({
  createItem: vi.fn(async (_ms: string, data: any) => ({ id: "v9", ...data })),
  uploadMedia: vi.fn(), createLink: vi.fn(),
}));
vi.mock("../../api/client", () => ({
  API_URL: "",
  api: { createItem, updateItem: vi.fn(), uploadMedia, createLink, searchPlaces: vi.fn(async () => []), readExif: vi.fn(), listIcons: vi.fn(async () => ({ builtin: [], custom: [] })) },
}));
import { VisitEditor } from "./VisitEditor";

const mapSet = { id: "ms1" } as any;

test("validates title, then saves a place visit", async () => {
  const onSaved = vi.fn();
  render(
    <VisitEditor mapSet={mapSet} item={null} themes={[]} trips={[]} customIcons={[]}
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
    <VisitEditor mapSet={mapSet} item={null} themes={[]} trips={[]} customIcons={[]}
      onRequestPick={async () => [0, 0]} onClose={() => {}} onSaved={() => {}} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
  expect(screen.getByText(/Theme/)).toBeInTheDocument();
});
