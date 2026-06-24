import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { createTrip } = vi.hoisted(() => ({ createTrip: vi.fn(async () => ({ id: "t9" })) }));
vi.mock("../../api/client", () => ({ API_URL: "", api: { createTrip, updateTrip: vi.fn(), deleteTrip: vi.fn() } }));
import { TripForm } from "./TripForm";

test("requires a name then creates a trip", async () => {
  const onSaved = vi.fn();
  render(<TripForm trip={null} onClose={() => {}} onSaved={onSaved} />);
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText(/please enter a name/i)).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/e.g. Italy/), { target: { value: "Italy 2025" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(createTrip).toHaveBeenCalledWith("", expect.objectContaining({ name: "Italy 2025" })));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});
