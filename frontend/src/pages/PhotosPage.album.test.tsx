import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../test/qc";
import { withUploads } from "../test/uploads";
const h = vi.hoisted(() => ({
  listTrips: vi.fn(async () => [{ id: "t1", name: "Italy", status: "planning", startDate: null, endDate: null, color: "#2563eb", description: "" }]),
  listMedia: vi.fn(async () => ({ items: [], nextCursor: null })),
  listShares: vi.fn(async () => []), createShare: vi.fn(), deleteShare: vi.fn(),
}));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { familyId: "f1" } }) }));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { PhotosPage } from "./PhotosPage";

test("shows a 'Share album' action only when filtered to a trip", async () => {
  const { rerender } = render(withQC(withUploads(<MemoryRouter><PhotosPage key="no-trip" /></MemoryRouter>)));
  // no trip filter → no album share
  expect(screen.queryByText(/Share album/)).not.toBeInTheDocument();
  // a distinct key forces a fresh mount so the initialTrip-seeded state applies
  rerender(withQC(withUploads(<MemoryRouter><PhotosPage key="with-trip" initialTrip="t1" /></MemoryRouter>)));
  expect(await screen.findByText(/Share album/)).toBeInTheDocument();
});
