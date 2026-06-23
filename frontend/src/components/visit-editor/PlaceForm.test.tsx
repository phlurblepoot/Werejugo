import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
const { searchPlaces } = vi.hoisted(() => ({ searchPlaces: vi.fn(async () => []) }));
vi.mock("../../api/client", () => ({ API_URL: "", api: { searchPlaces, readExif: vi.fn() } }));
import { PlaceForm } from "./PlaceForm";

test("shows the current coordinates and a pick button", () => {
  const onPick = vi.fn();
  render(
    <PlaceForm
      point={[-74, 40.7]}
      onSelect={() => {}}
      onPick={onPick}
      onPhotoLocation={() => {}}
    />,
  );
  expect(screen.getByText(/40\.7000, -74\.0000/)).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Pick on map/));
  expect(onPick).toHaveBeenCalled();
});
