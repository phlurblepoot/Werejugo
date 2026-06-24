import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { createDocument, searchEntities } = vi.hoisted(() => ({
  createDocument: vi.fn(async () => ({ id: "d9" })),
  searchEntities: vi.fn(async () => [{ type: "person", id: "p1", label: "Dad", thumbUrl: null }]),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { createDocument, updateDocument: vi.fn(), attachDocumentFile: vi.fn(), deleteDocument: vi.fn(), searchEntities } }));
import { DocumentForm } from "./DocumentForm";

test("validates title, picks a person owner, and creates", async () => {
  const onSaved = vi.fn();
  render(<DocumentForm doc={null} onClose={() => {}} onSaved={onSaved} />);
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText(/please enter a title/i)).toBeInTheDocument(); // validation (specific, not the "Title" label)

  fireEvent.change(screen.getByPlaceholderText(/e.g. Passport/), { target: { value: "Dad's Passport" } });
  fireEvent.click(screen.getByRole("button", { name: "Person" }));
  fireEvent.change(screen.getByPlaceholderText(/person/i), { target: { value: "da" } });
  fireEvent.mouseDown(await screen.findByText("Dad"));
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(createDocument).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Dad's Passport", ownerPersonId: "p1" }), null));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});
