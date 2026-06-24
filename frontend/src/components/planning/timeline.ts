export interface DateRange { startDate: string | null; endDate: string | null }

/** Left/width as percentages of an axis [axisStart, axisEnd]. Clamped to [0,100]. */
export function placeOnAxis(axisStart: string, axisEnd: string, start: string, end: string): { left: number; width: number } {
  const a = Date.parse(axisStart);
  const span = Date.parse(axisEnd) - a || 1;
  const s = Date.parse(start);
  const e = Date.parse(end);
  const left = Math.max(0, Math.min(100, ((s - a) / span) * 100));
  const right = Math.max(0, Math.min(100, ((e - a) / span) * 100));
  return { left, width: Math.max(1, right - left) };
}

/** Min start / max end across dated items, with a one-year fallback. */
export function axisBounds(items: DateRange[]): { start: string; end: string } {
  const starts = items.map((i) => i.startDate).filter(Boolean) as string[];
  const ends = items.map((i) => i.endDate ?? i.startDate).filter(Boolean) as string[];
  if (!starts.length) return { start: "2025-01-01", end: "2025-12-31" };
  return { start: starts.sort()[0], end: ends.sort()[ends.length - 1] };
}

/** True if a dated range overlaps a blackout range. */
export function overlaps(a: DateRange, b: DateRange): boolean {
  if (!a.startDate || !b.startDate) return false;
  const aS = Date.parse(a.startDate), aE = Date.parse(a.endDate ?? a.startDate);
  const bS = Date.parse(b.startDate), bE = Date.parse(b.endDate ?? b.startDate);
  return aS <= bE && bS <= aE;
}
