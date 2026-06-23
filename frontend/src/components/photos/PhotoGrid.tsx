import { API_URL, type MediaItem } from "../../api/client";
import { groupByMonth } from "./groupByMonth";

interface Props {
  items: MediaItem[];
  onOpen: (item: MediaItem) => void;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function PhotoGrid({ items, onOpen, hasMore, onLoadMore }: Props) {
  const groups = groupByMonth(items, (i) => i.takenAt ?? i.createdAt);
  return (
    <div>
      {groups.map((g) => (
        <div key={g.key} className="photo-month">
          <div className="datehdr">{g.label}</div>
          <div className="photo-grid-lib">
            {g.items.map((m) => (
              <button key={m.id} className="photo-cell" onClick={() => onOpen(m)} title={m.caption}>
                {m.kind === "image" ? (
                  <img src={`${API_URL}${m.thumbUrl ?? m.url}`} alt={m.caption || "Photo"} loading="lazy" />
                ) : (
                  <span className="media-placeholder">{m.kind === "video" ? "▶" : "🎵"}</span>
                )}
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
