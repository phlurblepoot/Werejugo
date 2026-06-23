import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { searchEntities } = vi.hoisted(() => ({ searchEntities: vi.fn(async () => [{ type: "person", id: "p1", label: "Mom", thumbUrl: null }]) }));
vi.mock("../../api/client", () => ({ API_URL: "", api: { searchEntities } }));
import { PhotoFilters } from "./PhotoFilters";

test("picking a person reports it; clearing removes it", async () => {
  const onChange = vi.fn();
  const { rerender } = render(<PhotoFilters value={{}} onChange={onChange} trips={[]} />);
  fireEvent.change(screen.getByPlaceholderText(/person/i), { target: { value: "mo" } });
  fireEvent.mouseDown(await screen.findByText("Mom"));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ person: "p1" }));

  rerender(<PhotoFilters value={{ person: "p1" }} onChange={onChange} trips={[]} />);
  fireEvent.click(screen.getByLabelText("Clear person filter"));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ person: undefined }));
});
