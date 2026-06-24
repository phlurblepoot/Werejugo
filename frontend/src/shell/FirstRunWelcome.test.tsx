import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
const h = vi.hoisted(() => ({ getStats: vi.fn(async () => ({ items: 0, photos: 0, trips: 0, firstDate: null, lastDate: null, countByKind: {}, distanceMetersByKind: {}, totalDistanceMeters: 0 })) }));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { FirstRunWelcome } from "./FirstRunWelcome";

test("welcomes a brand-new, empty hub", async () => {
  render(withQC(<MemoryRouter><FirstRunWelcome /></MemoryRouter>));
  expect(await screen.findByText(/Welcome to Werejugo/)).toBeInTheDocument();
});

test("renders nothing once there is data", async () => {
  h.getStats.mockResolvedValueOnce({ items: 3, photos: 0, trips: 1, firstDate: null, lastDate: null, countByKind: {}, distanceMetersByKind: {}, totalDistanceMeters: 0 });
  const { container } = render(withQC(<MemoryRouter><FirstRunWelcome /></MemoryRouter>));
  // allow the query to resolve
  await new Promise((r) => setTimeout(r, 0));
  expect(container.querySelector(".first-run")).toBeNull();
});
