/**
 * The photo timeline's layout, worked out from how many photos each month has
 * and how wide the view is — before any photos load. Rows have fixed heights,
 * so the scrollbar is right from the start and any month can be jumped to.
 */

export interface MonthCount { month: string; count: number }

export type TimelineRow =
  | { kind: "header"; month: string; label: string; top: number; height: number }
  | { kind: "photos"; month: string; start: number; count: number; top: number; height: number };

export interface TimelineLayout {
  rows: TimelineRow[];
  columns: number;
  cell: number;
  gap: number;
  height: number;
  /** Row index of each month's header. */
  monthRow: Map<string, number>;
  /** Each year's newest month ("2024" → "2024-12"), newest year first. */
  years: Array<{ year: string; month: string }>;
}

export interface LayoutOptions {
  /** The cell width to aim for (the real one fills the width exactly). */
  target?: number;
  minColumns?: number;
  gap?: number;
  header?: number;
}

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function layoutTimeline(months: MonthCount[], width: number, o: LayoutOptions = {}): TimelineLayout {
  const gap = o.gap ?? 4;
  const header = o.header ?? 40;
  const target = o.target ?? 150;
  const w = Math.max(width, 1);
  const columns = Math.max(o.minColumns ?? 3, Math.floor((w + gap) / (target + gap)));
  const cell = Math.max(1, (w - gap * (columns - 1)) / columns);
  const rows: TimelineRow[] = [];
  const monthRow = new Map<string, number>();
  const years: Array<{ year: string; month: string }> = [];
  let top = 0;
  for (const m of months) {
    if (m.count <= 0) continue;
    const year = m.month.slice(0, 4);
    if (years.at(-1)?.year !== year) years.push({ year, month: m.month });
    monthRow.set(m.month, rows.length);
    rows.push({ kind: "header", month: m.month, label: monthLabel(m.month), top, height: header });
    top += header;
    for (let start = 0; start < m.count; start += columns) {
      const height = cell + gap;
      rows.push({ kind: "photos", month: m.month, start, count: Math.min(columns, m.count - start), top, height });
      top += height;
    }
  }
  return { rows, columns, cell, gap, height: top, monthRow, years };
}

/** The months with rows between `from` and `to` (row indexes), to fetch. */
export function monthsInRows(layout: TimelineLayout, from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = Math.max(0, from); i <= Math.min(to, layout.rows.length - 1); i++) {
    const m = layout.rows[i].month;
    if (out.at(-1) !== m) out.push(m);
  }
  return out;
}
