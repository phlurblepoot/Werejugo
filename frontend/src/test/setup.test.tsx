import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("react-testing-library renders", () => {
  render(<div>hello shell</div>);
  expect(screen.getByText("hello shell")).toBeInTheDocument();
});
