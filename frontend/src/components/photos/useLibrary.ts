import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api, type MediaFilters, type MediaItem } from "../../api/client";

/**
 * The library's data, fetched a month at a time as the timeline scrolls.
 * Every key starts with "media", so invalidating ["media"] refreshes it all.
 */

export const timelineKey = (f: MediaFilters) => ["media", "timeline", f] as const;
export const monthKey = (f: MediaFilters, month: string) => ["media", "month", f, month] as const;

/** All of a month's photos (a month with thousands is fetched in pages). */
export async function fetchMonth(f: MediaFilters, month: string): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  let before: string | undefined;
  for (let i = 0; i < 40; i++) {
    const page = await api.listMedia({ ...f, month, limit: 500, before });
    items.push(...page.items);
    if (!page.nextCursor) break;
    before = page.nextCursor;
  }
  return items;
}

export function useTimeline(f: MediaFilters) {
  return useQuery({ queryKey: timelineKey(f), queryFn: () => api.mediaTimeline(f) });
}

export function useMonth(f: MediaFilters, month: string, enabled: boolean) {
  return useQuery({ queryKey: monthKey(f, month), queryFn: () => fetchMonth(f, month), enabled, staleTime: 60_000 });
}

/** The month a photo sits in on the timeline (UTC, like the server). */
export const monthOf = (m: Pick<MediaItem, "takenAt" | "createdAt">) => new Date(m.takenAt ?? m.createdAt).toISOString().slice(0, 7);

/**
 * The photo before or after `item` in timeline order, crossing into the
 * neighbouring month (and loading it) when needed. `months` is newest first.
 */
export async function neighbour(qc: QueryClient, f: MediaFilters, months: string[], item: MediaItem, dir: 1 | -1): Promise<MediaItem | null> {
  const load = (month: string) => qc.fetchQuery({ queryKey: monthKey(f, month), queryFn: () => fetchMonth(f, month), staleTime: 60_000 });
  let mi = months.indexOf(monthOf(item));
  if (mi < 0) return null;
  const list = await load(months[mi]);
  const i = list.findIndex((m) => m.id === item.id);
  if (i >= 0 && list[i + dir]) return list[i + dir];
  for (mi += dir; mi >= 0 && mi < months.length; mi += dir) {
    const next = await load(months[mi]);
    if (next.length) return dir === 1 ? next[0] : next[next.length - 1];
  }
  return null;
}
