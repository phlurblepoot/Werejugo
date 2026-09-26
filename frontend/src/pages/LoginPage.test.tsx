import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({ authConfig: vi.fn(async () => ({ firstRun: false })) }));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
const auth = vi.hoisted(() => ({ login: vi.fn(async () => {}), setup: vi.fn(async () => {}) }));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
import { LoginPage } from "./LoginPage";

test("a brand-new server only offers setting up the first family", async () => {
  h.authConfig.mockResolvedValueOnce({ firstRun: true });
  render(withQC(<LoginPage />));
  expect(await screen.findByText(/Set up Werejugo/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Your name"), "Pat");
  await userEvent.type(screen.getByLabelText(/Family name/), "The Wanderers");
  await userEvent.type(screen.getByLabelText("Email"), "pat@test.dev");
  await userEvent.type(screen.getByLabelText(/Password/), "long-enough");
  await userEvent.click(screen.getByRole("button", { name: /Create family/ }));
  expect(auth.setup).toHaveBeenCalledWith({ displayName: "Pat", familyName: "The Wanderers", email: "pat@test.dev", password: "long-enough" });
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
});

test("otherwise it's sign-in only: no open sign-up, no family codes", async () => {
  render(withQC(<LoginPage />));
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /New family/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Join/ })).toBeNull();
  expect(screen.queryByLabelText(/Family name/)).toBeNull();
  expect(screen.getByText(/Ask your family owner for an invite link/)).toBeInTheDocument();
});

test("signs in and shows why it failed", async () => {
  auth.login.mockRejectedValueOnce(new Error("Wrong email or password"));
  render(withQC(<LoginPage />));
  await userEvent.type(await screen.findByLabelText("Email"), "pat@test.dev");
  await userEvent.type(screen.getByLabelText("Password"), "nope");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(auth.login).toHaveBeenCalledWith("pat@test.dev", "nope");
  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password");
});
