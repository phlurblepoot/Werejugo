// Calendar dates ("YYYY-MM-DD") from the API have no time or timezone. Build
// them as *local* dates: `new Date("2024-06-01")` means UTC midnight, which is
// the previous day anywhere west of UTC.

type Ymd = string | null | undefined;

export function parseYmd(value: Ymd): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d);
  // Reject impossible dates such as 2024-02-30 instead of rolling them over.
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
  return date;
}

const OPTIONS: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

/** "Jun 1, 2024" (in the viewer's locale), or "" when there is no date. */
export function formatDate(value: Ymd, locale?: string): string {
  const d = parseYmd(value);
  return d ? new Intl.DateTimeFormat(locale, OPTIONS).format(d) : "";
}

/** "Jun 1 – 10, 2024" / "Jun 28 – Jul 3, 2024" / "Dec 28, 2024 – Jan 3, 2025". */
export function formatDateRange(start: Ymd, end: Ymd, locale?: string): string {
  const a = parseYmd(start);
  if (!a) return "";
  const b = parseYmd(end);
  const fmt = new Intl.DateTimeFormat(locale, OPTIONS);
  if (!b || b.getTime() === a.getTime()) return fmt.format(a);
  return fmt.formatRange(a, b);
}
