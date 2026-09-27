import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
import { withElementSize } from "../../test/size";

// 20,000 photos over ~7 years: 250 a month.
const MONTHS = Array.from({ length: 80 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 6 - i, 1));
  return { month: d.toISOString().slice(0, 7), count: 250 };
});
const { mediaTimeline, listMedia } = vi.hoisted(() => ({
  mediaTimeline: vi.fn(),
  listMedia: vi.fn(),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { mediaTimeline, listMedia } }));
import { LibraryTimeline } from "./LibraryTimeline";

const photo = (month: string, i: number) => ({
  id: `${month}-${i}`, kind: i % 50 === 0 ? "video" : "image", tripId: null, url: `/p/${month}-${i}`, thumbUrl: `/t/${month}-${i}`,
  caption: `${month} #${i}`, takenAt: `${month}-15T12:00:00.000Z`, createdAt: "", width: null, height: null, lng: null, lat: null, cursor: "",
  durationMs: i % 50 === 0 ? 65_000 : null,
});
mediaTimeline.mockResolvedValue({ months: MONTHS, total: 20_000 });
listMedia.mockImplementation(async (f: { month: string }) => ({ items: Array.from({ length: 250 }, (_, i) => photo(f.month, i)), nextCursor: null }));

withElementSize(800, 600);

test("20,000 photos: only the rows on screen are rendered, and only their months fetched", async () => {
  render(withQC(<LibraryTimeline filters={{}} />));
  expect(await screen.findByText("July 2025")).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^(Photo|Video)/ }).length).toBeGreaterThan(10));
  expect(screen.getAllByRole("button", { name: /^(Photo|Video)/ }).length).toBeLessThan(300);
  expect(listMedia.mock.calls.map((c) => c[0].month)).toEqual(["2025-07"]);
  expect(screen.getByLabelText(/Video: 2025-07 #0/)).toHaveTextContent("1:05");
});

test("the year rail jumps to that year", async () => {
  render(withQC(<LibraryTimeline filters={{}} />));
  const rail = await screen.findByRole("navigation", { name: "Jump to year" });
  expect(within(rail).getAllByRole("button").map((b) => b.textContent)).toEqual(["2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018"]);
  fireEvent.click(within(rail).getByRole("button", { name: "2019" }));
  expect(await screen.findByText("December 2019")).toBeInTheDocument();
  await waitFor(() => expect(listMedia.mock.calls.map((c) => c[0].month)).toContain("2019-12"));
});

test("it can open at a month", async () => {
  render(withQC(<LibraryTimeline filters={{}} initialMonth="2021-03" />));
  expect(await screen.findByText("March 2021")).toBeInTheDocument();
});

test("select mode: taps tick photos; Shift+click ticks the range", async () => {
  const onToggle = vi.fn();
  const { rerender } = render(withQC(<LibraryTimeline filters={{}} selection={{ selected: new Set(), onToggle }} />));
  const first = await screen.findByLabelText("Photo: 2025-07 #1");
  fireEvent.click(first);
  expect(onToggle).toHaveBeenLastCalledWith(expect.objectContaining({ id: "2025-07-1" }), null);
  fireEvent.click(screen.getByLabelText("Photo: 2025-07 #4"), { shiftKey: true });
  const range = onToggle.mock.calls.at(-1)![1];
  expect(range.map((m: { id: string }) => m.id)).toEqual(["2025-07-1", "2025-07-2", "2025-07-3", "2025-07-4"]);
  rerender(withQC(<LibraryTimeline filters={{}} selection={{ selected: new Set(["2025-07-1"]), onToggle }} />));
  expect(await screen.findByLabelText("Photo: 2025-07 #1")).toHaveAttribute("aria-pressed", "true");
});

test("without select mode a tap opens the photo; a long press starts selecting", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onOpen = vi.fn();
  const onLongPress = vi.fn();
  render(withQC(<LibraryTimeline filters={{}} onOpen={onOpen} onLongPress={onLongPress} />));
  const cell = await screen.findByLabelText("Photo: 2025-07 #2");
  fireEvent.click(cell);
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "2025-07-2" }));
  fireEvent.pointerDown(cell);
  act(() => { vi.advanceTimersByTime(600); });
  fireEvent.pointerUp(cell);
  fireEvent.click(cell);
  expect(onLongPress).toHaveBeenCalledWith(expect.objectContaining({ id: "2025-07-2" }));
  expect(onOpen).toHaveBeenCalledTimes(1); // the click after a long press doesn't open it
  vi.useRealTimers();
});

test("an empty library shows the empty state", async () => {
  mediaTimeline.mockResolvedValueOnce({ months: [], total: 0 });
  render(withQC(<LibraryTimeline filters={{ hidden: "only" }} empty={<p>Nothing hidden</p>} />));
  expect(await screen.findByText("Nothing hidden")).toBeInTheDocument();
});
