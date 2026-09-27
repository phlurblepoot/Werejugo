import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { Link } from "react-router-dom";
import { IconButton, PageHeader, SegmentedControl } from "../components/kit";
import { Images, LayoutGrid, Map as MapIcon, RefreshCw } from "lucide-react";
import { formatRelative } from "../lib/dates";
import { useAuth } from "../lib/auth";

export function PhotosPage({ initialTrip }: { initialTrip?: string } = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<MediaFilters>(initialTrip ? { trip: initialTrip } : {});
  const [view, setView] = useState<"grid" | "map">("grid");
  const [selected, setSelected] = useState<MediaItem | null>(null);
  // /photos?photo=<id> (e.g. from search) opens that photo.
  const [params, setParams] = useSearchParams();
  const wantedPhoto = params.get("photo");
  useEffect(() => {
    if (!wantedPhoto) return;
    api.getMedia(wantedPhoto).then(setSelected).catch(() => {});
    setParams({}, { replace: true });
  }, [wantedPhoto, setParams]);
  const [uploadedIds, setUploadedIds] = useState<string[] | null>(null);

  const { data: trips = [] } = useQuery({ queryKey: ["trips"], queryFn: () => api.listTrips() });

  const mediaQuery = useInfiniteQuery({
    queryKey: ["media", filters],
    queryFn: ({ pageParam }) => api.listMedia({ ...filters, before: pageParam, limit: 60 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items: MediaItem[] = mediaQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["media"] });

  // Photos live in the family's Immich account.
  const immich = useQuery({ queryKey: ["immich", "status"], queryFn: api.immichStatus });
  const noImmich = immich.data && !immich.data.enabled;
  const [pulling, setPulling] = useState(false);
  async function pullFromImmich() {
    setPulling(true);
    try {
      await api.refreshImmich();
      // The sync runs in the background; look again shortly.
      await new Promise((r) => setTimeout(r, 2500));
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["immich", "status"] })]);
    } catch {
      /* the next automatic sync will catch up */
    } finally {
      setPulling(false);
    }
  }
  const synced = immich.data?.lastSyncAt ? `updated ${formatRelative(immich.data.lastSyncAt)}` : "not updated yet";

  if (noImmich) {
    return (
      <div className="page">
        <PageHeader icon={Images} title="Photos" />
        <div className="page-fill">
          <EmptyState
            emoji="🖼️"
            title="Photos need Immich"
            hint={immich.data!.state === "error"
              ? "Werejugo can't reach your family's photo library right now."
              : "Your family's photos are kept in its own Immich photo library, which isn't connected yet."}
          />
          <p className="er-sub" style={{ textAlign: "center" }}>
            {user?.isAdmin ? <>Connect it in <Link to="/admin?tab=immich">Admin → Immich</Link>.</> : "Ask the server admin to connect your family."}
          </p>
        </div>
      </div>
    );
  }

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
            <IconButton
              icon={RefreshCw}
              label={pulling ? "Refreshing from Immich…" : `Refresh from Immich (${synced})`}
              onClick={() => void pullFromImmich()}
              disabled={pulling}
            />
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
          <EmptyState emoji="🖼️" title="No photos yet" hint="Upload photos here, or add them in Immich; they show up here within a few minutes." />
        ) : view === "grid" ? (
          <div style={{ padding: 16 }}>
            <PhotoGrid items={items} onOpen={setSelected} hasMore={mediaQuery.hasNextPage} onLoadMore={() => mediaQuery.fetchNextPage()} myFamilyId={user?.familyId} />
          </div>
        ) : (
          <PhotoMap items={items} onOpen={setSelected} />
        )}
      </div>

      {selected && (
        <PhotoDetail item={selected} trips={trips} myFamilyId={user?.familyId} onClose={() => setSelected(null)} onChanged={() => { refresh(); setSelected(null); }} />
      )}

      {uploadedIds && (
        <UploadReview mediaIds={uploadedIds} onDone={() => { setUploadedIds(null); refresh(); }} />
      )}
    </div>
  );
}
