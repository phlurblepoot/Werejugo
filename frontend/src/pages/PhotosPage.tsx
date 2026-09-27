import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, EyeOff, Eye, FolderMinus, Images, LayoutGrid, Map as MapIcon, RefreshCw, Trash2, X } from "lucide-react";
import { api, type MediaFilters, type MediaItem } from "../api/client";
import { MediaUploader } from "../components/shared/MediaUploader";
import { PhotoFilters } from "../components/photos/PhotoFilters";
import { LibraryTimeline } from "../components/photos/LibraryTimeline";
import { PhotoMap } from "../components/photos/PhotoMap";
import { PhotoViewer } from "../components/photos/PhotoViewer";
import { UploadReview } from "../components/photos/UploadReview";
import { neighbour, useTimeline } from "../components/photos/useLibrary";
import { EmptyState } from "../components/ui";
import { ShareButton } from "../components/shared/ShareButton";
import { Button, IconButton, PageHeader, SegmentedControl, useConfirm } from "../components/kit";
import { useToast } from "../components/Toast";
import { formatRelative } from "../lib/dates";
import { useAuth } from "../lib/auth";

export function PhotosPage({ initialTrip }: { initialTrip?: string } = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<MediaFilters>(() => {
    // /photos?trip=… and /photos?person=… (a person's page links here) open filtered.
    const trip = initialTrip ?? params.get("trip") ?? undefined;
    const person = params.get("person") ?? undefined;
    return { ...(trip ? { trip } : {}), ...(person ? { person } : {}) };
  });
  const [view, setView] = useState<"grid" | "map">("grid");
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadedIds, setUploadedIds] = useState<string[] | null>(null);

  // /photos?photo=<id> (from search, the map…) opens that photo.
  const wantedPhoto = params.get("photo");
  useEffect(() => {
    if (!wantedPhoto) return;
    api.getMedia(wantedPhoto).then(setOpen).catch(() => {});
    setParams({}, { replace: true });
  }, [wantedPhoto, setParams]);

  const { data: trips = [] } = useQuery({ queryKey: ["trips"], queryFn: () => api.listTrips() });
  const timeline = useTimeline(filters);
  const months = useMemo(() => (timeline.data?.months ?? []).map((m) => m.month), [timeline.data]);
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

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }
  // Only my family's photos can be changed (a shared trip's album shows others' too).
  const isMine = (m: MediaItem) => !m.familyId || m.familyId === user?.familyId;
  function toggle(item: MediaItem, range: MediaItem[] | null) {
    if (!isMine(item)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(item.id);
      for (const m of (range ?? [item]).filter(isMine)) { if (on) next.add(m.id); else next.delete(m.id); }
      return next;
    });
  }

  async function bulk(change: { hidden?: boolean; tripId?: string | null }, done: string) {
    try {
      await api.bulkMedia({ mediaIds: [...selected], ...change });
      toast(done, "success");
      stopSelecting();
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't change them", "error");
    }
  }
  async function deleteSelected() {
    const n = selected.size;
    const ok = await confirm({
      title: `Delete ${n} ${n === 1 ? "photo" : "photos"}?`,
      message: "They go to your family's Immich trash, where they can be restored for 30 days.",
      confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    let failed = 0;
    for (const id of [...selected]) await api.deletePhoto(id).catch(() => { failed++; });
    toast(failed ? `${n - failed} deleted, ${failed} couldn't be` : `${n} deleted`, failed ? "error" : "success");
    stopSelecting();
    await refresh();
  }

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

  const n = selected.size;
  return (
    <div className="page">
      <PageHeader
        icon={Images}
        title="Photos"
        views={
          <SegmentedControl
            label="View"
            value={view}
            onChange={(v) => { setView(v); stopSelecting(); }}
            options={[{ value: "grid", label: "Grid", icon: LayoutGrid }, { value: "map", label: "Map", icon: MapIcon }]}
          />
        }
        actions={
          <>
            {filters.trip && <ShareButton targetType="album" targetId={filters.trip} label="Share album" />}
            {view === "grid" && (
              <IconButton icon={CheckSquare} label={selecting ? "Stop selecting" : "Select photos"} aria-pressed={selecting}
                onClick={() => (selecting ? stopSelecting() : setSelecting(true))} />
            )}
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

      <PhotoFilters value={filters} onChange={(f) => { setFilters(f); stopSelecting(); }} trips={trips} />

      {selecting && (
        <div className="select-bar" role="toolbar" aria-label="Selected photos">
          <strong>{n ? `${n} selected` : "Tap photos to select them"}</strong>
          {n > 0 && (
            <>
              <select aria-label="Add to trip" value="" onChange={(e) => {
                const trip = trips.find((t) => t.id === e.target.value);
                if (trip) void bulk({ tripId: trip.id }, `${n} added to ${trip.name}`);
              }}>
                <option value="">Add to trip…</option>
                {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Button size="sm" icon={FolderMinus} onClick={() => void bulk({ tripId: null }, `${n} taken out of their trip`)}>Remove from trip</Button>
              {filters.hidden === "only"
                ? <Button size="sm" icon={Eye} onClick={() => void bulk({ hidden: false }, `${n} back in the library`)}>Show</Button>
                : <Button size="sm" icon={EyeOff} onClick={() => void bulk({ hidden: true }, `${n} hidden from the library`)}>Hide</Button>}
              <Button size="sm" variant="danger" icon={Trash2} onClick={() => void deleteSelected()}>Delete</Button>
            </>
          )}
          <IconButton size="sm" icon={X} label="Stop selecting" onClick={stopSelecting} />
        </div>
      )}

      <div className="page-fill" style={{ overflow: "hidden" }}>
        {view === "grid" ? (
          <LibraryTimeline
            filters={filters}
            onOpen={setOpen}
            selection={selecting ? { selected, onToggle: toggle } : undefined}
            onLongPress={(m) => { if (isMine(m)) { setSelecting(true); setSelected(new Set([m.id])); } }}
            myFamilyId={user?.familyId}
            empty={filters.hidden === "only"
              ? <EmptyState emoji="🙈" title="Nothing hidden" hint="Photos you hide from the library show up here." />
              : <EmptyState emoji="🖼️" title="No photos yet" hint="Upload photos here, or add them in Immich; they show up here within a few minutes." />}
          />
        ) : (
          <PhotoMap filters={filters} onOpen={(id) => void api.getMedia(id).then(setOpen).catch(() => {})} />
        )}
      </div>

      {open && (
        <PhotoViewer
          item={open}
          trips={trips}
          myFamilyId={user?.familyId}
          onClose={() => setOpen(null)}
          onChanged={() => void refresh()}
          onStep={(dir) => neighbour(qc, filters, months, open, dir).then((next) => { if (next) setOpen(next); return next; })}
        />
      )}

      {uploadedIds && (
        <UploadReview mediaIds={uploadedIds} onDone={() => { setUploadedIds(null); void refresh(); }} />
      )}
    </div>
  );
}
