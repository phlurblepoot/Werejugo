import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  updateMapSet: vi.fn(), createMapSet: vi.fn(), deleteMapSet: vi.fn(), importFile: vi.fn(), uploadImage: vi.fn(),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
vi.mock("./Toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import { MapSetEditor } from "./MapSetEditor";

const mapSet = { id: "m1", name: "Trips", description: "", baseKind: "vector", styleUrl: null, overlayUrl: null, overlayBounds: null, defaultLng: 0, defaultLat: 0, defaultZoom: 2, createdAt: "" } as any;

test("no longer offers a map share link", () => {
  render(<MapSetEditor mapSet={mapSet} onClose={() => {}} onSaved={() => {}} onDeleted={() => {}} onImported={() => {}} />);
  expect(screen.queryByText(/Create share link/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Share \(read-only/)).not.toBeInTheDocument();
});
