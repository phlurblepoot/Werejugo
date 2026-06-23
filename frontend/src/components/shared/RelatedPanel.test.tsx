import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { withQC } from "../../test/qc";

const { getRelations, deleteLink, createLink, searchEntities } = vi.hoisted(() => ({
  getRelations: vi.fn(async () => [
    { linkId: "l1", role: "", entity: { type: "visit", id: "v1", label: "Eiffel Tower", subtitle: null, thumbUrl: null } },
  ]),
  deleteLink: vi.fn(async () => {}),
  createLink: vi.fn(async () => ({ id: "l2" })),
  searchEntities: vi.fn(async () => []),
}));
vi.mock("../../api/client", () => ({ API_URL: "", api: { getRelations, deleteLink, createLink, searchEntities } }));
import { RelatedPanel } from "./RelatedPanel";

test("lists related entities and removes one", async () => {
  render(withQC(<RelatedPanel entity="person:p1" addTypes={["visit"]} />));
  expect(await screen.findByText("Eiffel Tower")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Remove Eiffel Tower"));
  await waitFor(() => expect(deleteLink).toHaveBeenCalledWith("l1"));
});
