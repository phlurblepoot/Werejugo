import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({ adminReturn: vi.fn(async () => ({ token: "home-token" })) }));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
const auth = vi.hoisted(() => ({
  adminView: null as null | { homeFamilyId: string; homeFamilyName: string },
  family: { id: "smiths", name: "The Smiths" },
  adoptToken: vi.fn(async () => {}),
}));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { AdminViewBanner } from "./AdminViewBanner";

test("hidden normally", () => {
  const { container } = render(<MemoryRouter><AdminViewBanner /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});

test("while viewing another family, says so and offers the way back", async () => {
  auth.adminView = { homeFamilyId: "home", homeFamilyName: "Our Family" };
  render(<MemoryRouter><AdminViewBanner /></MemoryRouter>);
  expect(screen.getByRole("status")).toHaveTextContent("You're viewing The Smiths as the server admin");
  await userEvent.click(screen.getByRole("button", { name: "Return to Our Family" }));
  await waitFor(() => expect(auth.adoptToken).toHaveBeenCalledWith("home-token"));
});
