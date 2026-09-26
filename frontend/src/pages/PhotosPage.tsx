import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type MediaFilters, type MediaItem } from "../api/client";
import { MediaUploader } from "../components/shared/MediaUploader";
import { PhotoFilters } from "../components/photos/PhotoFilters";
import { PhotoGrid } from "../components/photos/PhotoGrid";
import { PhotoMap } from "../components/photos/PhotoMap";
import { PhotoDetail } from "../components/photos/PhotoDetail";
import { UploadReview } from "../components/photos/UploadReview";
import { EmptyState, ErrorState, Spinner } from "../components/ui";
import { ShareButton } from "../components/shared/ShareButton";
import { PageHeader, SegmentedControl } from "../components/kit";
import { Images, LayoutGrid, Map as MapIcon } from "lucide-react";

export function PhotosPage({ initialTrip }: { initialTrip?: string } = {}) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<MediaFilters>(initialTrip ? { trip: initialTrip } : {});
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
    <div className="page">
      <PageHeader
        icon={Images}
        title="Photos"
        views={
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[{ value: "grid", label: "Grid", icon: LayoutGrid }, { value: "map", label: "Map", icon: MapIcon }]}
          />
        }
        actions={
          <>
            {filters.trip && <ShareButton targetType="album" targetId={filters.trip} label="Share album" />}
            <MediaUploader multiple label="Upload" onUploaded={() => {}} onAllUploaded={(media) => setUploadedIds(media.map((m) => m.id))} />
          </>
        }
      />

      <PhotoFilters value={filters} onChange={setFilters} trips={trips} />

      <div className="page-fill" style={{ overflow: view === "grid" ? "auto" : "hidden" }}>
        {mediaQuery.isError ? (
          <ErrorState hint="Couldn't load photos." onRetry={() => mediaQuery.refetch()} />
        ) : mediaQuery.isLoading ? (
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
