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

/** A moment in time (ISO timestamp) as "Sep 26, 2026, 3:04 PM". */
export function formatTimestamp(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { ...OPTIONS, hour: "numeric", minute: "2-digit" }).format(d);
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600], ["month", 30 * 24 * 3600], ["week", 7 * 24 * 3600],
  ["day", 24 * 3600], ["hour", 3600], ["minute", 60],
];

/** "3 days ago" / "in 5 days" / "just now" relative to `now`. */
export function formatRelative(iso: string | null | undefined, now = Date.now(), locale?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const secs = Math.round((t - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.trunc(secs / size), unit);
  }
  return "just now";
}

/** A video's length: 75_000 → "1:15", 3_725_000 → "1:02:05". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
