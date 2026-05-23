import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { KIND_LABELS } from "../lib/style";

interface Props {
  mapSetId: string;
  onClose: () => void;
}

function km(m: number) {
  return (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function mi(m: number) {
  return (m / 1609.344).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function StatsPanel({ mapSetId, onClose }: Props) {
  const { data, isLoading } = useQuery({ queryKey: ["stats", mapSetId], queryFn: () => api.getStats(mapSetId) });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Map stats</h2>
        {isLoading || !data ? (
          <div className="empty">Crunching numbers…</div>
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat-card"><div className="stat-n">{data.items}</div><div className="stat-l">items</div></div>
              <div className="stat-card"><div className="stat-n">{data.photos}</div><div className="stat-l">photos</div></div>
              <div className="stat-card"><div className="stat-n">{data.trips}</div><div className="stat-l">trips</div></div>
              <div className="stat-card">
                <div className="stat-n">{km(data.totalDistanceMeters)}</div>
                <div className="stat-l">km traveled</div>
              </div>
            </div>

            <div className="section-title"><span>Distance by mode</span></div>
            {Object.keys(data.distanceMetersByKind).length === 0 && <div className="empty">No routes yet.</div>}
            {Object.entries(data.distanceMetersByKind).map(([kind, meters]) => (
              <div key={kind} className="item-row">
                <div className="meta">
                  <div className="title">{KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind}</div>
                  <div className="sub">{km(meters)} km · {mi(meters)} mi</div>
                </div>
              </div>
            ))}

            <div className="section-title"><span>Items by type</span></div>
            {Object.entries(data.countByKind).map(([kind, n]) => (
              <div key={kind} className="item-row">
                <div className="meta"><div className="title">{KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind}</div></div>
                <div className="tag">{n}</div>
              </div>
            ))}

            {data.firstDate && (
              <p className="hint">Spanning {data.firstDate} → {data.lastDate}</p>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
