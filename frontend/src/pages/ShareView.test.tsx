import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  getShare: vi.fn(async () => ({
    targetType: "album",
    trip: { id: "t1", name: "Italy 2024", description: "", color: "#2563eb", startDate: null, endDate: null },
    photos: [{ id: "p1", url: "/api/files/x?sig=1", thumbUrl: null, mediaType: "image", caption: "Canal", seq: 0 }],
  })),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
import { ShareView } from "./ShareView";

test("renders a shared album gallery", async () => {
  render(
    <MemoryRouter initialEntries={["/s/tok"]}>
      <Routes><Route path="/s/:token" element={<ShareView />} /></Routes>
    </MemoryRouter>,
  );
  // the brand span renders "🖼️ Italy 2024" as adjacent text nodes, so match the name substring
  expect(await screen.findByText(/Italy 2024/)).toBeInTheDocument();
  expect(await screen.findByText(/read-only/)).toBeInTheDocument();
});

test("renders a shared smart album by its name", async () => {
  h.getShare.mockResolvedValueOnce({
    targetType: "smart_album", album: { name: "Sunsets" },
    photos: [{ id: "p1", url: "/api/m/p1/preview", thumbUrl: "/api/m/p1/thumbnail", mediaType: "image", caption: "Lake", seq: 0 }],
  } as never);
  render(
    <MemoryRouter initialEntries={["/s/tok"]}>
      <Routes><Route path="/s/:token" element={<ShareView />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Sunsets/)).toBeInTheDocument();
  expect(screen.getByText(/shared album · read-only/)).toBeInTheDocument();
  expect(screen.getByAltText("Lake")).toHaveAttribute("src", "/api/m/p1/thumbnail");
});
