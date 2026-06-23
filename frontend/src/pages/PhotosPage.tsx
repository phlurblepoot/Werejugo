import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type MediaFilters, type MediaItem } from "../api/client";
import { MediaUploader } from "../components/shared/MediaUploader";
import { PhotoFilters } from "../components/photos/PhotoFilters";
import { PhotoGrid } from "../components/photos/PhotoGrid";
import { PhotoMap } from "../components/photos/PhotoMap";
import { PhotoDetail } from "../components/photos/PhotoDetail";
import { UploadReview } from "../components/photos/UploadReview";
import { EmptyState, Spinner } from "../components/ui";

export function PhotosPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<MediaFilters>({});
  const [view, setView] = useState<"grid" | "map">("grid");
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [uploadedIds, setUploadedIds] = useState<string[] | null>(null);

  const { data: trips = [] } = useQuery({ queryKey: ["trips"], queryFn: () => api.listTrips("") });

  const mediaQuery = useInfiniteQuery({
    queryKey: ["media", filters],
    queryFn: ({ pageParam }) => api.listMedia({ ...filters, before: pageParam, limit: 60 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items: MediaItem[] = mediaQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["media"] });

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">🖼️ Photos</span>
        <span className="spacer" />
        <div className="tabs">
          <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>▦ Grid</button>
          <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>🗺️ Map</button>
        </div>
        <MediaUploader multiple label="⬆ Upload" onUploaded={() => {}} onAllUploaded={(media) => setUploadedIds(media.map((m) => m.id))} />
      </header>

      <div style={{ padding: "0 16px" }}>
        <PhotoFilters value={filters} onChange={setFilters} trips={trips} />
      </div>

      <div className="map-area" style={{ position: "relative", overflow: view === "grid" ? "auto" : "hidden" }}>
        {mediaQuery.isLoading ? (
          <Spinner label="Loading photos…" />
        ) : items.length === 0 ? (
          <EmptyState emoji="🖼️" title="No photos yet" hint="Upload photos to start your family library." />
        ) : view === "grid" ? (
          <div style={{ padding: 16 }}>
            <PhotoGrid items={items} onOpen={setSelected} hasMore={mediaQuery.hasNextPage} onLoadMore={() => mediaQuery.fetchNextPage()} />
          </div>
        ) : (
          <PhotoMap items={items} onOpen={setSelected} />
        )}
      </div>

      {selected && (
        <PhotoDetail item={selected} trips={trips} onClose={() => setSelected(null)} onChanged={() => { refresh(); setSelected(null); }} />
      )}

      {uploadedIds && (
        <UploadReview mediaIds={uploadedIds} onDone={() => { setUploadedIds(null); refresh(); }} />
      )}
    </div>
  );
}
