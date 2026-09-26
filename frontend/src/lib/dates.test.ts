import { afterEach, expect, test, vi } from "vitest";
import { formatDate, formatDateRange, parseYmd } from "./dates";

const norm = (s: string) => s.replace(/\s/g, " "); // Intl uses thin/narrow spaces around range dashes
afterEach(() => { vi.unstubAllEnvs(); });

test("parseYmd reads a calendar date as a local date", () => {
  const d = parseYmd("2024-06-01")!;
  expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2024, 5, 1]);
});

test("parseYmd tolerates legacy timestamps and rejects junk", () => {
  expect(parseYmd("2024-06-01T00:00:00.000Z")!.getDate()).toBe(1);
  expect(parseYmd("")).toBeNull();
  expect(parseYmd(null)).toBeNull();
  expect(parseYmd("not a date")).toBeNull();
  expect(parseYmd("2024-02-30")).toBeNull();
});

test("formatDate never shifts the day, even west of UTC", () => {
  vi.stubEnv("TZ", "America/Los_Angeles");
  // prove the zone switch took effect (UTC-7 in June), so this can't pass vacuously
  expect(new Date(2024, 5, 1).getTimezoneOffset()).toBe(420);
  expect(formatDate("2024-06-01", "en-US")).toBe("Jun 1, 2024");
});

test("formatDate returns an empty string for missing dates", () => {
  expect(formatDate(null, "en-US")).toBe("");
});

test("formatDateRange collapses what the two dates share", () => {
  expect(norm(formatDateRange("2024-06-01", "2024-06-10", "en-US"))).toBe("Jun 1 – 10, 2024");
  expect(norm(formatDateRange("2024-06-28", "2024-07-03", "en-US"))).toBe("Jun 28 – Jul 3, 2024");
  expect(norm(formatDateRange("2024-12-28", "2025-01-03", "en-US"))).toBe("Dec 28, 2024 – Jan 3, 2025");
});

test("formatDateRange handles a single or missing end date", () => {
  expect(formatDateRange("2024-06-01", null, "en-US")).toBe("Jun 1, 2024");
  expect(formatDateRange("2024-06-01", "2024-06-01", "en-US")).toBe("Jun 1, 2024");
  expect(formatDateRange(null, null, "en-US")).toBe("");
});
