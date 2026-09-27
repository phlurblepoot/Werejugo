import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { Suggestion } from "../../api/client";
import { withQC } from "../../test/qc";

const h = vi.hoisted(() => ({
  listSuggestions: vi.fn(async (): Promise<{ items: unknown[] }> => ({ items: [] })),
  applySuggestion: vi.fn(async (): Promise<Record<string, unknown>> => ({ attached: 3 })),
  dismissSuggestion: vi.fn(async () => undefined),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: h }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("../Toast", () => ({ useToast: () => ({ toast }) }));
import { describe as say, Suggestions } from "./Suggestions";

const sug = (o: Partial<Suggestion> & { kind: Suggestion["kind"] }): Suggestion => ({ key: `${o.kind}:x`, count: 3, thumbUrls: ["/api/m/a/thumbnail?e=1&s=x"], ...o });
beforeEach(() => vi.clearAllMocks());

test("each kind reads as a sentence", () => {
  expect(say(sug({ kind: "trip-photos", count: 143 })).title).toBe("143 photos taken during this trip");
  expect(say(sug({ kind: "trip-photos", count: 1 })).action).toBe("Add it");
  expect(say(sug({ kind: "visit-photos", count: 12 })).title).toBe("12 photos taken here");
  expect(say(sug({ kind: "trip-place", count: 23, label: "Florence", startDate: "2024-06-05" })).title).toBe("You took 23 photos near Florence");
  expect(say(sug({ kind: "trip-place", count: 5, label: null })).title).toBe("You took 5 photos somewhere that isn't a place on this trip");
  expect(say(sug({ kind: "trip-person", count: 12, person: { id: "g", displayName: "Grandma", familyName: null } })).title).toBe("Grandma is in 12 photos from this trip");
  const trip = say(sug({ kind: "new-trip", count: 143, label: "Lisbon", startDate: "2019-03-03", endDate: "2019-03-09" }));
  expect(trip.title).toBe("Looks like you were in Lisbon");
  expect(trip.detail).toMatch(/143 photos in no trip$/);
  const cruise = say(sug({ kind: "new-cruise", count: 86, stops: ["Miami", "Cozumel", "Roatán", "Costa Maya", "Belize City", "Miami"], startDate: "2019-03-03", endDate: "2019-03-10" }));
  expect(cruise.title).toBe("Looks like a cruise: Miami → Cozumel → Roatán → Costa Maya → … → Miami");
  expect(cruise.detail).toMatch(/86 photos, some at sea$/);
  expect(cruise.action).toBe("Create trip and cruise");
});

test("a trip's suggestions: add photos, review them in the picker, or dismiss", async () => {
  h.listSuggestions.mockResolvedValue({ items: [
    sug({ kind: "trip-photos", key: "trip-photos:t1", count: 143 }),
    sug({ kind: "trip-person", key: "trip-person:t1:g", count: 12, person: { id: "g", displayName: "Rose", familyName: "The Smiths" } }),
  ] });
  const onReview = vi.fn();
  render(withQC(<Suggestions target="trip:t1" onReview={onReview} />));
  const list = await screen.findByRole("region", { name: "Suggestions" });
  expect(h.listSuggestions).toHaveBeenCalledWith("trip:t1");
  expect(within(list).getByText("Rose is in 12 photos from this trip")).toBeInTheDocument();
  expect(within(list).getByText("The Smiths")).toBeInTheDocument();
  // Review only on photo suggestions.
  expect(within(list).getAllByRole("button", { name: "Review" })).toHaveLength(1);
  await userEvent.click(within(list).getByRole("button", { name: "Review" }));
  expect(onReview).toHaveBeenCalled();

  await userEvent.click(within(list).getByRole("button", { name: "Add them" }));
  await waitFor(() => expect(h.applySuggestion).toHaveBeenCalledWith("trip-photos:t1", undefined));
  expect(toast).toHaveBeenCalledWith("Added 3 photos", "success");

  await userEvent.click(within(list).getAllByRole("button", { name: "Not now" })[1]);
  await waitFor(() => expect(h.dismissSuggestion).toHaveBeenCalledWith("trip-person:t1:g"));
});

test("a place suggestion takes a name, prefilled from Immich's place name", async () => {
  h.listSuggestions.mockResolvedValue({ items: [sug({ kind: "trip-place", key: "trip-place:t1:43.770,11.256", count: 23, label: "Florence", startDate: "2024-06-05" })] });
  h.applySuggestion.mockResolvedValueOnce({ visitId: "v9", attached: 23 });
  render(withQC(<Suggestions target="trip:t1" />));
  const name = await screen.findByLabelText("Place name");
  expect(name).toHaveValue("Florence");
  await userEvent.clear(name);
  await userEvent.type(name, "Uffizi");
  await userEvent.click(screen.getByRole("button", { name: "Add place" }));
  await waitFor(() => expect(h.applySuggestion).toHaveBeenCalledWith("trip-place:t1:43.770,11.256", "Uffizi"));
  expect(toast).toHaveBeenCalledWith("Added “Uffizi” with 23 photos", "success");
});

test("trips in the photos: create one with its suggested name and hear which trip it made", async () => {
  h.listSuggestions.mockResolvedValue({ items: [sug({ kind: "new-trip", key: "new-trip:2019-03-03:2019-03-09:38.7,-9.1", count: 143, label: "Lisbon", startDate: "2019-03-03", endDate: "2019-03-09", name: "Lisbon, March 2019" })] });
  h.applySuggestion.mockResolvedValueOnce({ tripId: "t9", attached: 143 });
  const onApplied = vi.fn();
  render(withQC(<Suggestions target="library" title="Trips in your photos" onApplied={onApplied} />));
  expect(await screen.findByRole("region", { name: "Trips in your photos" })).toBeInTheDocument();
  expect(screen.getByLabelText("Trip name")).toHaveValue("Lisbon, March 2019");
  await userEvent.clear(screen.getByLabelText("Trip name"));
  expect(screen.getByRole("button", { name: "Create trip" })).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Trip name"), "Lisbon with Grandma");
  await userEvent.click(screen.getByRole("button", { name: "Create trip" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledWith({ tripId: "t9", attached: 143 }));
  expect(h.applySuggestion).toHaveBeenCalledWith("new-trip:2019-03-03:2019-03-09:38.7,-9.1", "Lisbon with Grandma");
  expect(toast).toHaveBeenCalledWith("Created “Lisbon with Grandma” with 143 photos", "success");
});

test("a suggestion that changed since says so", async () => {
  h.listSuggestions.mockResolvedValue({ items: [sug({ kind: "visit-photos", key: "visit-photos:v1" })] });
  h.applySuggestion.mockRejectedValueOnce(new Error("This suggestion has changed; have another look"));
  render(withQC(<Suggestions target="visit:v1" />));
  await userEvent.click(await screen.findByRole("button", { name: "Add them" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("This suggestion has changed; have another look", "error"));
});

test("nothing to suggest: nothing shown", async () => {
  render(withQC(<Suggestions target="trip:t1" />));
  await waitFor(() => expect(h.listSuggestions).toHaveBeenCalled());
  expect(screen.queryByRole("region")).toBeNull();
});
