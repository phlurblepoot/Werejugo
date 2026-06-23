import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "" }));
import { EntityList } from "./EntityList";
import { EntityDetail } from "./EntityDetail";

const people = [{ id: "1", label: "Mom" }, { id: "2", label: "Dad" }];

test("filters by search text and selects a row", () => {
  const onSelect = vi.fn();
  render(
    <EntityList
      items={people}
      getKey={(p) => p.id}
      getSearchText={(p) => p.label}
      renderRow={(p) => <span>{p.label}</span>}
      onSelect={onSelect}
      searchPlaceholder="Search people…"
    />,
  );
  fireEvent.change(screen.getByPlaceholderText("Search people…"), { target: { value: "da" } });
  expect(screen.queryByText("Mom")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Dad"));
  expect(onSelect).toHaveBeenCalledWith(people[1]);
});

test("EntityDetail shows title and fires onClose", () => {
  const onClose = vi.fn();
  render(<EntityDetail title="Mom" onClose={onClose}><div>body</div></EntityDetail>);
  expect(screen.getByText("Mom")).toBeInTheDocument();
  expect(screen.getByText("body")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Close"));
  expect(onClose).toHaveBeenCalled();
});
