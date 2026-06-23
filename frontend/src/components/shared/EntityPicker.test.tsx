import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const { searchEntities } = vi.hoisted(() => ({
  searchEntities: vi.fn(async () => [{ type: "visit", id: "v1", label: "Eiffel Tower", thumbUrl: null }]),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { searchEntities } }));
import { EntityPicker } from "./EntityPicker";

test("searches and picks an entity", async () => {
  const onPick = vi.fn();
  render(<EntityPicker type="visit" onPick={onPick} placeholder="Link a visit…" />);
  fireEvent.change(screen.getByPlaceholderText("Link a visit…"), { target: { value: "eiff" } });
  const opt = await screen.findByText("Eiffel Tower");
  expect(searchEntities).toHaveBeenCalledWith("visit", "eiff");
  fireEvent.mouseDown(opt);
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "v1", type: "visit" }));
});
