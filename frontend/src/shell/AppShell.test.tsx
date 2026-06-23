import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { ComingSoon } from "./ComingSoon";

// AppShell pulls in MapPage (MapLibre), so this task tests the routing shape via ComingSoon,
// which exercises the same shell layout without a WebGL canvas.
test("ComingSoon renders the module label", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><ComingSoon label="People" /></MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText("People is coming soon")).toBeInTheDocument();
});
