import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "" }));
import { PhotoGrid } from "./PhotoGrid";

const items = [
  { id: "a", kind: "image", tripId: null, url: "/api/files/a?sig=1", thumbUrl: "/api/files/a.t?sig=1", caption: "Sunset", takenAt: "2024-06-10T10:00:00Z", createdAt: "", width: null, height: null, lng: null, lat: null, cursor: "c1" },
] as any;

test("renders a date header and opens a photo on click", () => {
  const onOpen = vi.fn();
  render(<PhotoGrid items={items} onOpen={onOpen} hasMore={false} onLoadMore={() => {}} />);
  expect(screen.getByText(/June 2024/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("img", { name: "Sunset" }));
  expect(onOpen).toHaveBeenCalledWith(items[0]);
});

test("another family's photos in a shared trip's album say who added them", () => {
  const theirs = { id: "m9", kind: "image", tripId: "t1", url: "/u", thumbUrl: null, caption: "Lake", takenAt: "2025-07-12", createdAt: "2025-07-12", width: null, height: null, lng: null, lat: null, cursor: "c", familyId: "f2", familyName: "The Smiths" };
  const mine = { ...theirs, id: "m10", familyId: "f1", familyName: "Us" };
  render(<PhotoGrid items={[theirs, mine] as never} onOpen={() => {}} hasMore={false} onLoadMore={() => {}} myFamilyId="f1" />);
  expect(screen.getByTitle("Added by The Smiths")).toBeInTheDocument();
  expect(screen.queryByTitle("Added by Us")).toBeNull();
});
