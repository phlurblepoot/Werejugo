import type { Waypoint } from "../api/client";

/**
 * Compact "Jun 17 · 08:00–17:00" style label for a waypoint's arrival/departure.
 * Waypoint times are the local wall-clock time at that place, written as UTC
 * (a ship in Cozumel at 08:00 is 08:00Z), so they're shown in UTC: never
 * converted to the viewer's time zone.
 */
export function formatWaypointTime(wp: Pick<Waypoint, "arriveAt" | "departAt">): string {
  const a = wp.arriveAt ? new Date(wp.arriveAt) : null;
  const d = wp.departAt ? new Date(wp.departAt) : null;
  const ref = a ?? d;
  if (!ref || Number.isNaN(ref.getTime())) return "";
  const date = ref.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const hasTime = (x: Date | null) => x && (x.getUTCHours() !== 0 || x.getUTCMinutes() !== 0);
  const t = (x: Date) => x.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  if (a && d && hasTime(a) && hasTime(d)) return `${date} · ${t(a)}–${t(d)}`;
  if (d && hasTime(d)) return `${date} · dep ${t(d)}`;
  if (a && hasTime(a)) return `${date} · arr ${t(a)}`;
  return date;
}
