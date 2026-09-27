import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MediaImage } from "./MediaImage";

afterEach(() => { vi.useRealTimers(); });

test("a thumbnail that isn't ready yet shows a placeholder, then tries again", () => {
  vi.useFakeTimers();
  render(<MediaImage src="/api/m/x/thumbnail?e=1&s=a" alt="Beach" />);
  fireEvent.error(screen.getByRole("img", { name: "Beach" }));
  expect(screen.getByRole("img", { name: "Beach" }).tagName).toBe("SPAN");
  act(() => { vi.advanceTimersByTime(2000); });
  const retry = screen.getByRole("img", { name: "Beach" });
  expect(retry.tagName).toBe("IMG");
  expect(retry).toHaveAttribute("src", "/api/m/x/thumbnail?e=1&s=a&r=1");
});
