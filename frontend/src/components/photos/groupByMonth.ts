export interface MonthGroup<T> { key: string; label: string; items: T[] }

/** Group items by YYYY-MM of the given date, newest month first. Null dates → "Undated". */
export function groupByMonth<T>(items: T[], dateOf: (item: T) => string | null): MonthGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const d = dateOf(it);
    const key = d ? d.slice(0, 7) : "0000-00";
    const arr = map.get(key) ?? [];
    arr.push(it);
    map.set(key, arr);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, groupItems]) => ({ key, label: labelFor(key), items: groupItems }));
}

function labelFor(key: string): string {
  if (key === "0000-00") return "Undated";
  return new Date(`${key}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
