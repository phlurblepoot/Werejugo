import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { Rail } from "./Rail";

test("the search button calls onSearch", () => {
  const onSearch = vi.fn();
  render(<MemoryRouter><Rail onSignOut={() => {}} onSearch={onSearch} /></MemoryRouter>);
  fireEvent.click(screen.getByText("Search"));
  expect(onSearch).toHaveBeenCalled();
});

test("offers a Settings link", () => {
  render(<MemoryRouter><Rail onSignOut={() => {}} /></MemoryRouter>);
  expect(screen.getByText("Settings").closest("a")).toHaveAttribute("href", "/settings");
});
