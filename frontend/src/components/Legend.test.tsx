import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Legend } from "./Legend";
import type { Item } from "../api/client";

const item = (kind: string, props: Record<string, unknown> = {}) => ({ id: Math.random().toString(), kind, properties: props }) as unknown as Item;

test("the legend shows pins as the map draws them: the family's colours, and cruise lines with a look of their own", () => {
  const settings = { pin: { byKind: { food: { color: "#111111" } }, byLine: { "Royal Caribbean": { color: "#003399" } } } };
  const items = [item("food"), item("cruise", { cruiseLine: "Royal Caribbean" }), item("cruise", { cruiseLine: "Carnival" })];
  render(<Legend items={items} kindFilter={[]} onToggleKind={() => {}} settings={settings} />);
  const swatch = (label: string) => (screen.getByText(label).previousElementSibling as HTMLElement).style.background;
  expect(swatch("Food")).toBe("rgb(17, 17, 17)");
  expect(swatch("Cruise")).toBe("rgb(13, 148, 136)"); // the kind's own default
  expect(swatch("Royal Caribbean")).toBe("rgb(0, 51, 153)");
  expect(screen.queryByText("Carnival")).toBeNull();
});
