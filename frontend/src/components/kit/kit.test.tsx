import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { Map as MapIcon, Trash2 } from "lucide-react";
import { ShellContext } from "../../shell/ShellContext";
import {
  Avatar, Button, Chip, ConfirmProvider, IconButton, Menu, Modal, PageHeader, SegmentedControl, useConfirm,
} from "./index";

test("Button never submits a form unless asked to", () => {
  render(<form><Button>Save</Button><Button type="submit">Go</Button></form>);
  expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("type", "submit");
});

test("a loading Button is disabled and busy", () => {
  render(<Button loading>Save</Button>);
  const b = screen.getByRole("button", { name: "Save" });
  expect(b).toBeDisabled();
  expect(b).toHaveAttribute("aria-busy", "true");
});

test("IconButton is named by its label", () => {
  render(<IconButton label="Delete trip" icon={Trash2} />);
  expect(screen.getByRole("button", { name: "Delete trip" })).toBeInTheDocument();
});

test("SegmentedControl marks the chosen option and reports changes", async () => {
  const onChange = vi.fn();
  render(<SegmentedControl label="View" value="grid" onChange={onChange}
    options={[{ value: "grid", label: "Grid" }, { value: "map", label: "Map", icon: MapIcon }]} />);
  expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(screen.getByRole("button", { name: "Map" }));
  expect(onChange).toHaveBeenCalledWith("map");
});

test("Modal is a named dialog that closes on Escape", async () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return <Modal open={open} onOpenChange={setOpen} title="Edit trip"><p>Body</p></Modal>;
  }
  render(<Harness />);
  expect(screen.getByRole("dialog", { name: "Edit trip" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("useConfirm resolves true on confirm and false on cancel", async () => {
  const results: boolean[] = [];
  function Asker() {
    const confirm = useConfirm();
    return <Button onClick={async () => results.push(await confirm({ title: "Delete trip?", confirmLabel: "Delete", danger: true }))}>Ask</Button>;
  }
  render(<ConfirmProvider><Asker /></ConfirmProvider>);

  await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(screen.getByRole("dialog", { name: "Delete trip?" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(results).toEqual([true]));

  await userEvent.click(screen.getByRole("button", { name: "Ask" }));
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(results).toEqual([true, false]));
});

test("Menu opens from its trigger and runs the chosen item", async () => {
  const onSelect = vi.fn();
  render(<Menu trigger={<Button>Options</Button>} items={[{ label: "Rename", onSelect }, "separator", { label: "Delete", onSelect: () => {}, danger: true }]} />);
  await userEvent.click(screen.getByRole("button", { name: "Options" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
  expect(onSelect).toHaveBeenCalled();
});

test("PageHeader shows the title, actions, and a search button wired to the shell", async () => {
  const openSearch = vi.fn();
  render(
    <ShellContext.Provider value={{ openSearch }}>
      <PageHeader icon={MapIcon} title="Map" actions={<Button>Add</Button>} />
    </ShellContext.Provider>,
  );
  expect(screen.getByRole("heading", { name: "Map" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(openSearch).toHaveBeenCalled();
});

test("PageHeader has no search button outside the shell", () => {
  render(<PageHeader title="Map" />);
  expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
});

test("Avatar falls back to initials; Chip can be removed", async () => {
  const onRemove = vi.fn();
  const { container } = render(<><Avatar name="Aunt Venicia" /><Chip onRemove={onRemove} removeLabel="Remove Mom">Mom</Chip></>);
  expect(container.textContent).toContain("AV");
  await userEvent.click(screen.getByRole("button", { name: "Remove Mom" }));
  expect(onRemove).toHaveBeenCalled();
});
