import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { lookupFlight } = vi.hoisted(() => ({ lookupFlight: vi.fn(async () => ({ title: "JFK → CDG", waypoints: [], path: [], warnings: [] })) }));
vi.mock("../../api/client", () => ({ API_URL: "", api: { lookupFlight } }));
import { FlightForm } from "./FlightForm";

test("looks up airport codes and reports the result", async () => {
  const onResult = vi.fn();
  render(<FlightForm onResult={onResult} />);
  fireEvent.change(screen.getByPlaceholderText(/JFK, CDG/), { target: { value: "JFK, CDG" } });
  fireEvent.click(screen.getByText("Plot route"));
  await waitFor(() => expect(lookupFlight).toHaveBeenCalledWith({ codes: ["JFK", "CDG"] }));
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ title: "JFK → CDG" })));
});
