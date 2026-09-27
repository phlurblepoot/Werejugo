import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, Eye, EyeOff, Trash2, X } from "lucide-react";
import { api, API_URL, type MediaItem } from "../../api/client";
import { RelatedPanel } from "../shared/RelatedPanel";
import { MediaImage } from "../shared/MediaImage";
import { Button, IconButton, useConfirm } from "../kit";

interface Props {
  item: MediaItem;
  trips: { id: string; name: string }[];
  myFamilyId?: string;
  onClose: () => void;
  /** Something changed (caption, trip, hidden, deleted): refresh the library. */
  onChanged: () => void;
  /** Step to the photo before (-1) or after (1); resolves null at either end. */
  onStep?: (dir: 1 | -1) => Promise<MediaItem | null>;
}

/**
 * One photo or video, full-screen: the picture (or the playing video) large,
 * its details beside it on desktop and below it on phones. ← → (or a swipe)
 * steps through the library in timeline order.
 */
export function PhotoViewer({ item: first, trips, myFamilyId, onClose, onChanged, onStep }: Props) {
  const confirm = useConfirm();
  const [item, setItem] = useState(first);
  const [busy, setBusy] = useState(false);
  const [ends, setEnds] = useState<{ prev: boolean; next: boolean }>({ prev: false, next: false });
  useEffect(() => { setItem(first); }, [first]);
  const theirs = item.familyId && myFamilyId && item.familyId !== myFamilyId ? item.familyName ?? "another family" : null;

  async function step(dir: 1 | -1) {
    if (!onStep || busy) return;
    setBusy(true);
    try {
      const next = await onStep(dir);
      if (next) setItem(next);
      else setEnds((e) => (dir === 1 ? { ...e, next: true } : { ...e, prev: true }));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { setEnds({ prev: false, next: false }); }, [item.id]);

  // ← → step, unless typing in a field.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") void stepRef.current(1);
      if (e.key === "ArrowLeft") void stepRef.current(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const touch = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touch.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touch.current === null) return;
    const dx = e.changedTouches[0].clientX - touch.current;
    touch.current = null;
    if (dx > 50) void step(-1);
    else if (dx < -50) void step(1);
  };

  async function saveCaption(caption: string) {
    if (caption === item.caption) return;
    await api.updatePhoto(item.id, caption);
    setItem({ ...item, caption });
    onChanged();
  }
  async function setTrip(tripId: string | null) {
    await api.setMediaTrip(item.id, tripId);
    setItem({ ...item, tripId });
    onChanged();
  }
  async function toggleHidden() {
    const updated = await api.setMediaHidden(item.id, !item.hidden);
    setItem({ ...item, hidden: updated.hidden });
    onChanged();
  }
  async function remove() {
    const ok = await confirm({
      title: `Delete this ${item.kind === "video" ? "video" : "photo"}?`,
      message: "It goes to your family's Immich trash, where it can be restored for 30 days.",
      confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    await api.deletePhoto(item.id);
    onChanged();
    onClose();
  }

  const label = item.caption || (item.kind === "video" ? "Video" : "Photo");
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="viewer-overlay" />
        <Dialog.Content className="viewer" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <div className="viewer-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {item.kind === "video" && item.videoUrl ? (
              <video
                key={item.id} className="viewer-media" src={`${API_URL}${item.videoUrl}`} poster={`${API_URL}${item.url}`}
                controls playsInline preload="metadata" aria-label={label}
              />
            ) : (
              <MediaImage key={item.id} className="viewer-media" src={`${API_URL}${item.url}`} alt={label} />
            )}
            {onStep && (
              <>
                <IconButton className="viewer-nav viewer-prev" icon={ChevronLeft} label="Previous" disabled={busy || ends.prev} onClick={() => void step(-1)} />
                <IconButton className="viewer-nav viewer-next" icon={ChevronRight} label="Next" disabled={busy || ends.next} onClick={() => void step(1)} />
              </>
            )}
            <Dialog.Close asChild>
              <IconButton className="viewer-close" icon={X} label="Close" />
            </Dialog.Close>
          </div>

          <aside className="viewer-info">
            <div className="er-sub viewer-meta">
              {item.takenAt ? new Date(item.takenAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "No date"}
              {item.lat != null && item.lng != null ? ` · ${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}` : ""}
              {item.hidden && <span className="viewer-hidden-note"> · Hidden from the library</span>}
            </div>

            {theirs ? (
              <p className="photo-theirs">
                {item.caption && <strong>{item.caption} · </strong>}Added by {theirs}. Only they can change or delete it.
              </p>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="viewer-caption">Caption</label>
                  <input id="viewer-caption" key={`c-${item.id}`} defaultValue={item.caption} placeholder="Caption…" onBlur={(e) => void saveCaption(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="viewer-trip">Trip</label>
                  <select id="viewer-trip" key={`t-${item.id}`} defaultValue={item.tripId ?? ""} onChange={(e) => void setTrip(e.target.value || null)}>
                    <option value="">— No trip —</option>
                    {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </>
            )}

            <RelatedPanel key={item.id} entity={`media:${item.id}`} addTypes={theirs ? [] : ["person", "visit"]} />

            <div className="viewer-actions">
              {item.originalUrl && (
                <a className="btn-link" href={`${API_URL}${item.originalUrl}`} download={item.originalName || true}>
                  <Download size={15} aria-hidden="true" /> Download original
                </a>
              )}
              {!theirs && (
                <>
                  <Button size="sm" icon={item.hidden ? Eye : EyeOff} onClick={() => void toggleHidden()}>
                    {item.hidden ? "Show in library" : "Hide from library"}
                  </Button>
                  <Button size="sm" variant="danger" icon={Trash2} onClick={() => void remove()}>Delete</Button>
                </>
              )}
            </div>
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
