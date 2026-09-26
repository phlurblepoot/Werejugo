import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({ authConfig: vi.fn(async () => ({ firstRun: false, signupOpen: false })) }));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ login: vi.fn(), register: vi.fn() }) }));
import { LoginPage } from "./LoginPage";

test("a brand-new server only offers setting up the first family", async () => {
  h.authConfig.mockResolvedValueOnce({ firstRun: true, signupOpen: true });
  render(withQC(<LoginPage />));
  expect(await screen.findByText(/Set up Werejugo/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Family name/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
});

test("with signup closed there is no 'New family' option", async () => {
  render(withQC(<LoginPage />));
  expect(await screen.findByRole("button", { name: "Join" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "New family" })).toBeNull();
});

test("with signup open, 'New family' is offered", async () => {
  h.authConfig.mockResolvedValueOnce({ firstRun: false, signupOpen: true });
  render(withQC(<LoginPage />));
  expect(await screen.findByRole("button", { name: "New family" })).toBeInTheDocument();
});
