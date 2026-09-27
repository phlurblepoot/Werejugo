import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withApp } from "../test/app";
const h = vi.hoisted(() => ({
  listTrips: vi.fn(async () => [{ id: "t1", name: "Italy", status: "planning", startDate: null, endDate: null, color: "#2563eb", description: "" }]),
  listMedia: vi.fn(async () => ({ items: [], nextCursor: null })),
  mediaTimeline: vi.fn(async () => ({ months: [], total: 0 })),
  immichStatus: vi.fn(async () => ({ enabled: true, state: "created", lastSyncAt: null, photoCount: 0 })),
  listShares: vi.fn(async () => []), createShare: vi.fn(), deleteShare: vi.fn(),
}));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { familyId: "f1" } }) }));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { PhotosPage } from "./PhotosPage";

test("shows a 'Share album' action only when filtered to a trip", async () => {
  const { rerender } = render(withApp(<MemoryRouter><PhotosPage key="no-trip" /></MemoryRouter>));
  // no trip filter → no album share
  expect(screen.queryByText(/Share album/)).not.toBeInTheDocument();
  // a distinct key forces a fresh mount so the initialTrip-seeded state applies
  rerender(withApp(<MemoryRouter><PhotosPage key="with-trip" initialTrip="t1" /></MemoryRouter>));
  expect(await screen.findByText(/Share album/)).toBeInTheDocument();
});
