import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({ API_URL: "", api: { searchPlaces: vi.fn(async () => []) } }));
import { DriveForm } from "./DriveForm";

test("renders the drive stop builder", () => {
  render(<DriveForm stops={[]} onChange={() => {}} />);
  expect(screen.getByText(/Stops along the drive/)).toBeInTheDocument();
});
