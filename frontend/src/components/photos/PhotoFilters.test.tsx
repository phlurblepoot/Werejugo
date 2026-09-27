import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { searchEntities, getPerson } = vi.hoisted(() => ({
  searchEntities: vi.fn(async () => [{ type: "person", id: "p1", label: "Mom", thumbUrl: null }]),
  getPerson: vi.fn(async (id: string) => ({ id, displayName: "Grandma Rose" })),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { searchEntities, getPerson } }));
import { withQC } from "../../test/qc";
import { PhotoFilters } from "./PhotoFilters";

test("picking a person reports it; clearing removes it", async () => {
  const onChange = vi.fn();
  const { rerender } = render(withQC(<PhotoFilters value={{}} onChange={onChange} trips={[]} />));
  fireEvent.change(screen.getByPlaceholderText(/person/i), { target: { value: "mo" } });
  fireEvent.mouseDown(await screen.findByText("Mom"));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ person: "p1" }));

  rerender(withQC(<PhotoFilters value={{ person: "p1" }} onChange={onChange} trips={[]} />));
  fireEvent.click(screen.getByLabelText("Clear person filter"));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ person: undefined }));
});

test("a person filter from the address shows their name", async () => {
  render(withQC(<PhotoFilters value={{ person: "rose" }} onChange={() => {}} trips={[]} />));
  expect(await screen.findByText(/Grandma Rose/)).toBeInTheDocument();
  expect(getPerson).toHaveBeenCalledWith("rose");
});
