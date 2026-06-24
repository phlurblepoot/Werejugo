import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { Rail } from "./Rail";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Rail onSignOut={() => {}} />
    </MemoryRouter>,
  );
}

test("renders every module label", () => {
  renderAt("/map");
  expect(screen.getByText("Map")).toBeInTheDocument();
  expect(screen.getByText("People")).toBeInTheDocument();
  expect(screen.getByText("Packing")).toBeInTheDocument();
});

test("marks the active module", () => {
  renderAt("/map");
  expect(screen.getByText("Map").closest(".rail-item")).toHaveClass("active");
});

test("renders enabled modules as active links, not disabled", () => {
  renderAt("/map");
  const packing = screen.getByText("Packing").closest(".rail-item");
  expect(packing).not.toHaveClass("disabled");
  expect(packing).toHaveAttribute("href", "/packing");
});
