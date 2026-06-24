import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ErrorState } from "./ui";

test("shows the message and fires retry", () => {
  const onRetry = vi.fn();
  render(<ErrorState hint="Network down" onRetry={onRetry} />);
  expect(screen.getByText("Network down")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Try again"));
  expect(onRetry).toHaveBeenCalled();
});

test("omits the retry button when no handler is given", () => {
  render(<ErrorState title="Broke" />);
  expect(screen.getByText("Broke")).toBeInTheDocument();
  expect(screen.queryByText("Try again")).not.toBeInTheDocument();
});
