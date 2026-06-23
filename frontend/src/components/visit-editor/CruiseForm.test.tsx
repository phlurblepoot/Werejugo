import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
vi.mock("../../api/client", () => ({
  API_URL: "",
  api: { searchCruiseLines: vi.fn(async () => []), searchCruiseShips: vi.fn(async () => []), searchPorts: vi.fn(async () => []) },
}));
import { CruiseForm } from "./CruiseForm";
import type { VisitDraft } from "./useVisitDraft";

const draft = { kind: "cruise", cruiseLine: "", ship: "", stops: [], occurredOn: "", title: "" } as unknown as VisitDraft;

test("renders the CruiseMapper finder and a stops builder", () => {
  render(<CruiseForm draft={draft} set={() => {}} />);
  expect(screen.getByText(/Find on CruiseMapper/)).toBeInTheDocument();
  expect(screen.getByText(/Ports of call/)).toBeInTheDocument();
});
