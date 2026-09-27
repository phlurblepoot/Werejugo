import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { Rail } from "./Rail";

test("the account menu shows who is signed in and signs out", async () => {
  const onSignOut = vi.fn();
  render(
    <MemoryRouter>
      <Rail onSignOut={onSignOut} account={{ displayName: "Pat Traveler", email: "pat@test.dev" }} />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Account: Pat Traveler" }));
  expect(await screen.findByText("pat@test.dev")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
  expect(onSignOut).toHaveBeenCalled();
});
