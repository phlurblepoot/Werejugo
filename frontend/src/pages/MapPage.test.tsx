import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { withQC } from "../test/qc";

const place = (over: Record<string, unknown>) => ({
  kind: "place", notes: "", themeId: null, tripId: null, color: null, icon: null, occurredOn: null,
  geometry: { type: "Point", coordinates: [0, 0] }, waypoints: [], photos: [], createdBy: null, createdByName: null,
  familyId: "f1", familyName: "Us", canEdit: true, personIds: [], ...over,
});
const h = vi.hoisted(() => ({
  listVisits: vi.fn(),
  listTrips: vi.fn(async () => [{ id: "t1", name: "Italy", color: "#0f766e", role: "host" }, { id: "t2", name: "Tahoe", color: "#b45309", role: "contributor", hostFamilyName: "The Smiths" }]),
  listPeople: vi.fn(async () => [{ id: "p1", displayName: "Kid" }]),
  listThemes: vi.fn(async () => []),
  listIcons: vi.fn(async () => ({ builtin: [], custom: [] })),
  getSettings: vi.fn(async () => ({})),
  listComments: vi.fn(async () => []),
  getStats: vi.fn(async () => ({})),
}));
vi.mock("../api/client", () => ({ API_URL: "", api: h }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", familyId: "f1", role: "owner" }, family: { id: "f1", name: "Us" } }) }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ toast: () => {}, celebrate: () => {} }) }));
// The real map needs WebGL; here it just lists what it would draw.
vi.mock("../components/MapView", () => ({
  MapView: (p: { items: Array<{ id: string; title: string }> }) => <ul aria-label="On the map">{p.items.map((i) => <li key={i.id}>{i.title}</li>)}</ul>,
}));
import { MapPage } from "./MapPage";

function Where() {
  const l = useLocation();
  return <output aria-label="url">{l.search}</output>;
}
const renderAt = (url = "/map") => render(withQC(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="/map" element={<><MapPage /><Where /></>} /></Routes>
  </MemoryRouter>,
));

beforeEach(() => {
  h.listVisits.mockResolvedValue([
    place({ id: "v1", title: "Colosseum", tripId: "t1", occurredOn: "2024-06-02", personIds: ["p1"] }),
    place({ id: "v2", title: "Joe's Pizza", kind: "food", occurredOn: "2023-03-10" }),
    place({ id: "v3", title: "Beach day", tripId: "t2", occurredOn: "2025-07-12", familyId: "f2", familyName: "The Smiths", canEdit: false }),
  ]);
});

test("every place I can see is on the one map, other families' marked", async () => {
  renderAt();
  const onMap = await screen.findByRole("list", { name: "On the map" });
  await waitFor(() => expect(within(onMap).getAllByRole("listitem")).toHaveLength(3));
  expect(screen.getByTitle("Added by The Smiths")).toBeInTheDocument();
  expect(screen.queryByLabelText("Edit Beach day")).toBeNull();
  expect(screen.getByLabelText("Edit Colosseum")).toBeInTheDocument();
});

test("every kind the server stores has a pin and a legend entry (a stay used to blank the page)", async () => {
  h.listVisits.mockResolvedValue([place({ id: "v9", title: "Lakeside cabin", kind: "stay" })]);
  renderAt();
  expect(await screen.findByText("Lakeside cabin", { selector: "li" })).toBeInTheDocument();
  expect(screen.getAllByText("Stay").length).toBeGreaterThan(0);
});

test("filters live in the URL, and a filtered URL shows the filtered map", async () => {
  renderAt();
  await screen.findByText("Joe's Pizza", { selector: "li" });
  await userEvent.selectOptions(screen.getByLabelText("Trip"), "t1");
  expect(screen.getByLabelText("url")).toHaveTextContent("?trip=t1");
  await waitFor(() => expect(within(screen.getByRole("list", { name: "On the map" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Colosseum"]));

  // The legend follows the other filters: only the trip's kinds, still toggleable.
  expect(document.querySelector(".legend")?.textContent).toBe("📍Place1");
  await userEvent.selectOptions(screen.getByLabelText("Added by"), "others");
  expect(screen.getByLabelText("url")).toHaveTextContent("family=others");
  expect(await screen.findByText(/Places \(0 of 3\)/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.getByLabelText("url")).toHaveTextContent(/^$/);
});

test("a bookmarked filter URL is applied on load", async () => {
  renderAt("/map?person=p1&year=2024");
  await waitFor(() => expect(within(screen.getByRole("list", { name: "On the map" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Colosseum"]));
  expect(screen.getByLabelText("Person")).toHaveValue("p1");
});

test("/map?visit=<id> opens that place; another family's is view-only", async () => {
  renderAt("/map?visit=v3");
  expect(await screen.findByRole("heading", { name: "Beach day" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete item" })).toBeNull();
  await userEvent.click(screen.getAllByRole("button", { name: "Close" }).pop()!);
  expect(screen.getByLabelText("url")).not.toHaveTextContent("visit=");
});

test("the header menu has import, styles, appearance and stats; the old panels are gone", async () => {
  renderAt();
  await userEvent.click(await screen.findByRole("button", { name: "More actions" }));
  for (const label of ["Import places (GPX, KML, GeoJSON)", "Pin styles & icons", "Map appearance", "Travel stats"]) {
    expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
  }
  expect(screen.queryByText(/Map set/)).toBeNull();
  expect(screen.getByRole("link", { name: "Planning" })).toHaveAttribute("href", "/planning");
});
