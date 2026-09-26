import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { BottomNav } from "./BottomNav";

const account = { displayName: "Pat Traveler", email: "pat@test.dev" };
const renderAt = (path: string, props: Partial<Parameters<typeof BottomNav>[0]> = {}) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav onSignOut={vi.fn()} onSearch={vi.fn()} account={account} {...props} />
    </MemoryRouter>,
  );

test("shows the four main tabs plus More, marking the current one", () => {
  renderAt("/photos");
  const nav = screen.getByRole("navigation", { name: "Main" });
  for (const [label, href] of [["Map", "/map"], ["Photos", "/photos"], ["Docs", "/documents"], ["Trips", "/planning"]]) {
    expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", href);
  }
  expect(within(nav).getByRole("link", { name: "Photos" })).toHaveClass("active");
  expect(within(nav).getByRole("button", { name: "More" })).toBeInTheDocument();
});

test("shows the documents badge on the Docs tab", () => {
  renderAt("/map", { badges: { documents: 3 } });
  expect(screen.getByRole("link", { name: /Docs/ })).toHaveTextContent("3");
});

test("More opens a sheet with the other modules, search, settings and sign out", async () => {
  const onSignOut = vi.fn();
  const onSearch = vi.fn();
  renderAt("/map", { onSignOut, onSearch });
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  const sheet = screen.getByRole("dialog", { name: "More" });
  expect(within(sheet).getByText("Pat Traveler")).toBeInTheDocument();
  expect(within(sheet).getByRole("link", { name: "People" })).toHaveAttribute("href", "/people");
  expect(within(sheet).getByRole("link", { name: "Packing" })).toHaveAttribute("href", "/packing");
  expect(within(sheet).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  await userEvent.click(within(sheet).getByRole("button", { name: "Sign out" }));
  expect(onSignOut).toHaveBeenCalled();
});

test("More → Search opens the command palette", async () => {
  const onSearch = vi.fn();
  renderAt("/map", { onSearch });
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Search" }));
  expect(onSearch).toHaveBeenCalled();
});
