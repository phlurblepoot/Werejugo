import { API_URL, type MediaItem } from "../../api/client";
import { groupByMonth } from "./groupByMonth";
import { ByFamily, otherFamily } from "../shared/ByFamily";
import { MediaImage } from "../shared/MediaImage";

interface Props {
  items: MediaItem[];
  onOpen: (item: MediaItem) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  /** To mark another family's photos (a shared trip's album). */
  myFamilyId?: string;
}

export function PhotoGrid({ items, onOpen, hasMore, onLoadMore, myFamilyId }: Props) {
  const groups = groupByMonth(items, (i) => i.takenAt ?? i.createdAt);
  return (
    <div>
      {groups.map((g) => (
        <div key={g.key} className="photo-month">
          <div className="datehdr">{g.label}</div>
          <div className="photo-grid-lib">
            {g.items.map((m) => (
              <button key={m.id} className="photo-cell" onClick={() => onOpen(m)} title={m.caption}>
                {m.kind !== "audio" && m.thumbUrl ? (
                  <MediaImage src={`${API_URL}${m.thumbUrl}`} alt={m.caption || (m.kind === "video" ? "Video" : "Photo")} loading="lazy" />
                ) : (
                  <span className="media-placeholder">{m.kind === "video" ? "▶" : "🎵"}</span>
                )}
                {m.kind === "video" && m.thumbUrl && (
                  <span className="play-badge" aria-label="Video">▶{m.durationMs ? ` ${formatDuration(m.durationMs)}` : ""}</span>
                )}
                <ByFamily name={otherFamily(m, myFamilyId)} />
              </button>
            ))}
          </div>
        </div>
      ))}
      {hasMore && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button onClick={onLoadMore}>Load more</button>
        </div>
      )}
    </div>
  );
}

/** 75_000 → "1:15" */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
