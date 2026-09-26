import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ThemeProvider, useTheme, THEME_KEY } from "./theme";

function Probe() {
  const { preference, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="pref">{preference}</span>
      <button onClick={() => setPreference("dark")}>dark</button>
      <button onClick={() => setPreference("system")}>system</button>
    </div>
  );
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.restoreAllMocks();
});

test("defaults to following the system, with no data-theme attribute", () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByTestId("pref")).toHaveTextContent("system");
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
});

test("choosing a theme applies it and remembers it", () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  act(() => screen.getByText("dark").click());
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");

  act(() => screen.getByText("system").click());
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(localStorage.getItem(THEME_KEY)).toBeNull();
});

test("restores the saved preference on load", () => {
  localStorage.setItem(THEME_KEY, "light");
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByTestId("pref")).toHaveTextContent("light");
  expect(document.documentElement.dataset.theme).toBe("light");
});

test("works when storage is unavailable (e.g. private browsing)", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(screen.getByTestId("pref")).toHaveTextContent("system");
  act(() => screen.getByText("dark").click());
  expect(document.documentElement.dataset.theme).toBe("dark");
});
