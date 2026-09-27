import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const EMPTY = { items: 0, photos: 0, trips: 0, firstDate: null, lastDate: null, countByKind: {}, distanceMetersByKind: {}, totalDistanceMeters: 0 };
const h = vi.hoisted(() => ({ getStats: vi.fn() }));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ family: { id: "fam-1" } }) }));
import { FirstRunWelcome } from "./FirstRunWelcome";

afterEach(() => { localStorage.clear(); h.getStats.mockReset(); });
const renderIt = () => render(withQC(<MemoryRouter><FirstRunWelcome /></MemoryRouter>));

test("welcomes a brand-new, empty hub without covering the page", async () => {
  h.getStats.mockResolvedValue(EMPTY);
  renderIt();
  const card = await screen.findByRole("complementary", { name: /getting started/i });
  expect(card).toHaveTextContent(/Welcome to Werejugo/);
  // It is a small card, not a full-screen overlay (the old version covered every page).
  expect(card.className).toContain("first-run-card");
  expect(screen.getByRole("link", { name: /add people/i })).toHaveAttribute("href", "/people");
});

test("renders nothing once there is data", async () => {
  h.getStats.mockResolvedValue({ ...EMPTY, items: 3, trips: 1 });
  const { container } = renderIt();
  await new Promise((r) => setTimeout(r, 0));
  expect(container.querySelector(".first-run-card")).toBeNull();
});

test("can be dismissed, and stays dismissed for this family", async () => {
  h.getStats.mockResolvedValue(EMPTY);
  const first = renderIt();
  fireEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
  expect(screen.queryByRole("complementary", { name: /getting started/i })).toBeNull();
  first.unmount();

  renderIt();
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole("complementary", { name: /getting started/i })).toBeNull();
});
