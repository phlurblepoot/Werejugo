import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";
const { updatePhoto, deletePhoto, setMediaTrip, getRelations } = vi.hoisted(() => ({
  updatePhoto: vi.fn(async () => ({})), deletePhoto: vi.fn(async () => {}),
  setMediaTrip: vi.fn(async () => ({})), getRelations: vi.fn(async () => []),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { updatePhoto, deletePhoto, setMediaTrip, getRelations, createLink: vi.fn(), deleteLink: vi.fn(), searchEntities: vi.fn(async () => []) } }));
import { PhotoDetail } from "./PhotoDetail";

const item = { id: "m1", kind: "image", tripId: null, url: "/api/files/a?sig=1", thumbUrl: null, caption: "Hi", takenAt: "2024-06-10T10:00:00Z", createdAt: "", width: null, height: null, lng: 12.5, lat: 41.9, cursor: "c" } as any;

test("edits caption and deletes", async () => {
  const onChanged = vi.fn(); const onClose = vi.fn();
  render(withQC(<PhotoDetail item={item} trips={[]} onChanged={onChanged} onClose={onClose} />));
  const cap = screen.getByDisplayValue("Hi");
  fireEvent.change(cap, { target: { value: "Sunset" } });
  fireEvent.blur(cap);
  await waitFor(() => expect(updatePhoto).toHaveBeenCalledWith("m1", "Sunset"));
  fireEvent.click(screen.getByText("Delete"));
  await waitFor(() => expect(deletePhoto).toHaveBeenCalledWith("m1"));
});
