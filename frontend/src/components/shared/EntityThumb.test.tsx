import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "" }));
import { EntityThumb } from "./EntityThumb";

test("renders an image when a thumbUrl is given", () => {
  render(<EntityThumb thumbUrl="/api/files/x?sig=1" label="Mom" />);
  expect(screen.getByRole("img")).toHaveAttribute("src", "/api/files/x?sig=1");
});

test("falls back to an initial when no thumbUrl", () => {
  render(<EntityThumb thumbUrl={null} label="Grandma" />);
  expect(screen.getByText("G")).toBeInTheDocument();
});
