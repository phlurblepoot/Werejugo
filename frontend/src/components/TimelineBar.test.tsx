import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { TimelineBar, timelineTicks } from "./TimelineBar";
import type { Item } from "../api/client";

const item = (occurredOn: string | null) => ({ id: Math.random().toString(), occurredOn }) as unknown as Item;

test("ticks: years over a long span, months over a short one", () => {
  expect(timelineTicks("2019-06-01", "2023-02-01").map((t) => t.label)).toEqual(["2020", "2021", "2022", "2023"]);
  const months = timelineTicks("2024-01-10", "2024-06-20");
  expect(months.map((t) => t.label)).toEqual(["Feb", "Mar", "Apr", "May", "Jun"]);
  expect(months[0].at).toBeGreaterThan(0);
  expect(months[months.length - 1].at).toBeLessThan(1);
});

test("undated items: counted on a chip that shows or hides them", async () => {
  const onShowUndated = vi.fn();
  render(<TimelineBar items={[item("2024-01-01"), item("2024-05-01"), item(null), item(null)]} cursor="2024-05-01" onCursor={() => {}} onClose={() => {}} showUndated onShowUndated={onShowUndated} />);
  const chip = screen.getByRole("button", { name: "No date (2)" });
  expect(chip).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(chip);
  expect(onShowUndated).toHaveBeenCalledWith(false);
});

test("a strip shows how many items fall on each part of the timeline", () => {
  const { container } = render(<TimelineBar items={[item("2024-01-01"), item("2024-01-02"), item("2024-12-31")]} cursor={null} onCursor={() => {}} onClose={() => {}} showUndated onShowUndated={() => {}} />);
  const bars = [...container.querySelectorAll<HTMLElement>(".timeline-density span")];
  expect(bars.length).toBeGreaterThan(10);
  expect(bars.filter((b) => b.style.height !== "0%").length).toBe(2);
});

test("with nothing dated it says so, and undated items still show", () => {
  render(<TimelineBar items={[item(null)]} cursor={null} onCursor={() => {}} onClose={() => {}} showUndated onShowUndated={() => {}} />);
  expect(screen.getByText(/Add dates to items to use the timeline/)).toBeInTheDocument();
});
