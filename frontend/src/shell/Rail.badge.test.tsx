import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { Rail } from "./Rail";

// Badge only renders on enabled modules; Documents isn't enabled until Task 6,
// so test the mechanism on "map" (already enabled).
test("renders a numeric badge for a module when provided", () => {
  render(
    <MemoryRouter initialEntries={["/map"]}>
      <Rail onSignOut={() => {}} badges={{ map: 2 }} />
    </MemoryRouter>,
  );
  expect(screen.getByText("2")).toBeInTheDocument();
});

test("renders no badge when the count is 0 or absent", () => {
  render(
    <MemoryRouter initialEntries={["/map"]}>
      <Rail onSignOut={() => {}} badges={{ map: 0 }} />
    </MemoryRouter>,
  );
  expect(screen.queryByText("0")).not.toBeInTheDocument();
});
