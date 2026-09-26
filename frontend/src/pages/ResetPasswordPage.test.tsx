import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({
  resetPreview: vi.fn(async () => ({ displayName: "Pat", email: "pat@test.dev" })),
  resetPassword: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { ResetPasswordPage } from "./ResetPasswordPage";

const renderAt = () => render(withQC(
  <MemoryRouter initialEntries={["/reset/tok"]}>
    <Routes><Route path="/reset/:token" element={<ResetPasswordPage />} /></Routes>
  </MemoryRouter>,
));

test("sets a new password once both entries match", async () => {
  renderAt();
  expect(await screen.findByText(/pat@test.dev/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("New password"), "brand-new-pw");
  await userEvent.type(screen.getByLabelText("Repeat new password"), "brand-new-typo");
  await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
  expect(screen.getByRole("alert")).toHaveTextContent("don't match");
  expect(h.resetPassword).not.toHaveBeenCalled();

  await userEvent.clear(screen.getByLabelText("Repeat new password"));
  await userEvent.type(screen.getByLabelText("Repeat new password"), "brand-new-pw");
  await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
  expect(h.resetPassword).toHaveBeenCalledWith("tok", "brand-new-pw");
  expect(await screen.findByText("Password changed")).toBeInTheDocument();
});

test("a used or expired link explains itself", async () => {
  h.resetPreview.mockRejectedValueOnce(new Error("gone"));
  renderAt();
  expect(await screen.findByText("Link not valid")).toBeInTheDocument();
});
