import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { Rail } from "./Rail";

test("only admins get the Admin entry", () => {
  const { rerender } = render(
    <MemoryRouter><Rail onSignOut={() => {}} account={{ displayName: "Pat", email: "p@test.dev", isAdmin: false }} /></MemoryRouter>,
  );
  expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  rerender(<MemoryRouter><Rail onSignOut={() => {}} account={{ displayName: "Sam", email: "s@test.dev", isAdmin: true }} /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
});
