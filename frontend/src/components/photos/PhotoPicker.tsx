import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Images } from "lucide-react";
import { api, API_URL, type MediaItem } from "../../api/client";
import { Button, EmptyState, Modal, SegmentedControl, Spinner } from "../kit";
import { MediaImage } from "../shared/MediaImage";
import { MediaUploader } from "../shared/MediaUploader";
import { useToast } from "../Toast";
import { LibraryTimeline } from "./LibraryTimeline";

interface Props {
  /** What the photos are for: "visit:<id>", "trip:<id>", "person:<id>" or "itinerary:<id>". */
  entity: string;
  /** Where "Upload new" puts new photos ("visit:…", "person:…", "trip:…"); none hides it. */
  uploadLinkTo?: string | null;
  onClose: () => void;
  onAttached?: (count: number) => void;
}

/** What shows a place's, trip's or person's photos. */
const REFRESH = ["media", "visits", "relations", "person", "people", "trips", "itinerary"];

/**
 * "Add photos": pick from the whole library, opening on the photos taken
 * then and there (during the item's dates, or near its place).
 */
export function PhotoPicker({ entity, uploadLinkTo, onClose, onAttached }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const sug = useQuery({ queryKey: ["media", "for", entity], queryFn: () => api.mediaFor(entity) });
  const [tab, setTab] = useState<"then" | "all" | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const items = sug.data?.items ?? [];
  const attached = useMemo(() => new Set(items.filter((m) => m.attached).map((m) => m.id)), [items]);

  // Open on the suggestions when there are any. For an item with no photos
  // yet, the photos taken both then and there start ticked.
  useEffect(() => {
    if (!sug.data || tab) return;
    setTab(sug.data.items.length ? "then" : "all");
    if (!sug.data.items.some((m) => m.attached)) setSelected(new Set(sug.data.items.filter((m) => m.match === "both").map((m) => m.id)));
  }, [sug.data, tab]);

  function toggle(item: MediaItem, range: MediaItem[] | null) {
    setSelected((prev) => {
      const next = new Set(prev);
      const list = (range ?? [item]).filter((m) => !attached.has(m.id));
      const on = !prev.has(item.id);
      for (const m of list) { if (on) next.add(m.id); else next.delete(m.id); }
      return next;
    });
  }

  async function add() {
    if (!selected.size) return;
    setSaving(true);
    try {
      const r = await api.attachMedia([...selected], entity);
      for (const k of REFRESH) void qc.invalidateQueries({ queryKey: [k] });
      toast(r.skipped.length
        ? `Added ${r.attached} · ${r.skipped.length} couldn't be added (${r.skipped[0].reason})`
        : `Added ${r.attached} ${r.attached === 1 ? "photo" : "photos"}`, r.skipped.length ? "error" : "success");
      onAttached?.(r.attached);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't add the photos", "error");
    } finally {
      setSaving(false);
    }
  }

  const title = sug.data ? `Add photos to ${sug.data.label}` : "Add photos";
  const span = sug.data?.window;
  const hint = sug.data && (span || sug.data.near)
    ? `Taken ${span ? (span.from === span.to ? `on ${span.from}` : `${span.from} – ${span.to}`) : ""}${span && sug.data.near ? " or " : ""}${sug.data.near ? "nearby" : ""}`
    : null;

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={title}
      size="lg"
      footer={
        <div className="picker-foot">
          {uploadLinkTo && (
            <MediaUploader multiple label="Upload new" linkTo={uploadLinkTo}
              linkRole={uploadLinkTo.startsWith("visit:") ? "appears_in" : ""} onUploaded={() => { for (const k of REFRESH) void qc.invalidateQueries({ queryKey: [k] }); }} />
          )}
          <span className="er-sub picker-count" aria-live="polite">{selected.size ? `${selected.size} selected` : "Nothing selected"}</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!selected.size} onClick={() => void add()}>
            Add {selected.size || ""} {selected.size === 1 ? "photo" : "photos"}
          </Button>
        </div>
      }
    >
      {sug.isLoading || !tab ? (
        <Spinner label="Looking for photos…" />
      ) : (
        <>
          <div className="picker-tabs">
            <SegmentedControl
              label="Show"
              value={tab}
              onChange={setTab}
              options={[
                { value: "then", label: `Then and there${items.length ? ` (${items.length})` : ""}` },
                { value: "all", label: "All photos", icon: Images },
              ]}
            />
            {tab === "then" && hint && <span className="er-sub">{hint}</span>}
          </div>
          <div className="picker-body">
            {tab === "then" ? (
              items.length ? (
                <div className="picker-grid">
                  {items.map((m) => {
                    const on = selected.has(m.id);
                    const done = attached.has(m.id);
                    return (
                      <button
                        key={m.id} type="button" className={`photo-cell${on ? " is-selected" : ""}`} disabled={done}
                        aria-pressed={on} aria-label={`${m.kind === "video" ? "Video" : "Photo"}${m.caption ? `: ${m.caption}` : ""}${done ? " (already added)" : ""}`}
                        onClick={() => toggle(m, null)}
                      >
                        {m.thumbUrl && <MediaImage src={`${API_URL}${m.thumbUrl}`} alt="" loading="lazy" />}
                        {done ? <span className="lib-badge">Added</span> : <span className={`lib-check${on ? " on" : ""}`} aria-hidden="true">{on && <Check size={14} />}</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState title="No photos from then and there" hint="Nothing in your library was taken during its dates or near its place. Look through all your photos instead." />
              )
            ) : (
              <LibraryTimeline
                filters={{}}
                initialMonth={sug.data?.month}
                selection={{ selected, onToggle: toggle }}
                badge={(m) => (attached.has(m.id) ? <span className="lib-badge">Added</span> : null)}
                empty={<EmptyState title="No photos yet" hint="Upload some, or add them in Immich." />}
              />
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
