import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type SearchResults } from "../api/client";

const GROUPS: Array<{ key: keyof SearchResults; label: string }> = [
  { key: "people", label: "People" },
  { key: "trips", label: "Trips" },
  { key: "visits", label: "Visits" },
  { key: "photos", label: "Photos" },
  { key: "documents", label: "Documents" },
];
const EMPTY: SearchResults = { people: [], trips: [], visits: [], photos: [], documents: [] };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { data = EMPTY } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: q.trim().length > 0,
  });
  if (!open) return null;

  const go = (to: string) => { onClose(); setQ(""); nav(to); };
  const total = GROUPS.reduce((n, g) => n + data[g.key].length, 0);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Search people, trips, photos, documents…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        />
        <div className="palette-results">
          {q.trim().length === 0 && <div className="er-sub palette-hint">Type to search across everything.</div>}
          {q.trim().length > 0 && total === 0 && <div className="er-sub palette-hint">No matches.</div>}
          {GROUPS.map((g) =>
            data[g.key].length > 0 ? (
              <div key={g.key} className="palette-group">
                <div className="palette-group-label">{g.label}</div>
                {data[g.key].map((hit) => (
                  <button key={hit.id} className="palette-hit" onClick={() => go(hit.to)}>
                    {hit.thumbUrl ? (
                      <img src={hit.thumbUrl} alt="" className="palette-thumb" />
                    ) : (
                      <span className="palette-thumb placeholder" aria-hidden="true" />
                    )}
                    <span>{hit.label}</span>
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
