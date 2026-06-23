import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const { createPerson, listFamilyMembers } = vi.hoisted(() => ({
  createPerson: vi.fn(async (d: any) => ({ id: "p9", ...d, avatarUrl: null })),
  listFamilyMembers: vi.fn(async () => []),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { createPerson, listFamilyMembers } }));
import { PersonForm } from "./PersonForm";

test("requires a name then creates a person", async () => {
  const onSaved = vi.fn();
  render(<PersonForm person={null} onClose={() => {}} onSaved={onSaved} />);
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText(/please enter a name/i)).toBeInTheDocument(); // validation message
  expect(createPerson).not.toHaveBeenCalled();

  fireEvent.change(screen.getByPlaceholderText("e.g. Grandma"), { target: { value: "Grandma" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(createPerson).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Grandma" })));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});
