import type { ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { API_URL, api, type MediaFilters, type MediaItem } from "../../api/client";
import { Button, EmptyState, Spinner } from "../kit";

/** The smart-search results for `q` within the library's filters, most relevant first. */
export function useSmartSearch(q: string, filters: MediaFilters) {
  return useInfiniteQuery({
    queryKey: ["media", "search", q, filters],
    queryFn: ({ pageParam }) => api.searchMedia(q, filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextPage ?? undefined,
    enabled: q.length > 0,
    retry: false,
  });
}

export function SearchResults({ q, filters, onOpen, empty }: {
  q: string;
  filters: MediaFilters;
  onOpen: (item: MediaItem, list: MediaItem[]) => void;
  empty?: ReactNode;
}) {
  const s = useSmartSearch(q, filters);
  const items = s.data?.pages.flatMap((p) => p.items) ?? [];
  const status = (s.error as { status?: number } | null)?.status;

  if (s.isLoading) return <Spinner label={`Looking for “${q}”…`} />;
  if (status === 409) {
    return <EmptyState emoji="🔎" title="Smart search is off" hint="Searching what's in photos needs Immich's machine learning, which is turned off on your Immich server." />;
  }
  if (s.isError) return <EmptyState emoji="🔌" title="Couldn't search" hint={s.error instanceof Error ? s.error.message : undefined} />;
  if (!items.length && !s.hasNextPage) return <>{empty ?? <EmptyState emoji="🔎" title={`No photos of “${q}”`} hint="Try other words, or fewer filters." />}</>;

  return (
    <div className="search-results">
      <ul className="search-grid" aria-label={`Photos of “${q}”`}>
        {items.map((m) => (
          <li key={m.id}>
            <button type="button" className="search-cell" aria-label={`Photo: ${m.caption || m.originalName}`} onClick={() => onOpen(m, items)}>
              <img src={`${API_URL}${m.thumbUrl}`} alt="" loading="lazy" />
              {m.kind === "video" && <span className="play-badge" aria-hidden="true">▶</span>}
            </button>
          </li>
        ))}
      </ul>
      {s.hasNextPage && (
        <div className="search-more">
          <Button onClick={() => void s.fetchNextPage()} disabled={s.isFetchingNextPage}>{s.isFetchingNextPage ? "Loading…" : "More"}</Button>
        </div>
      )}
    </div>
  );
}
