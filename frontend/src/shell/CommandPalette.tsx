import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, API_URL, type SearchResults } from "../api/client";

const GROUPS: Array<{ key: keyof SearchResults; label: string }> = [
  { key: "people", label: "People" },
  { key: "trips", label: "Trips" },
  { key: "visits", label: "Visits" },
  { key: "photos", label: "Photos" },
  { key: "documents", label: "Documents" },
];
const EMPTY: SearchResults = { people: [], trips: [], visits: [], photos: [], documents: [] };

/** Smart search (what's in the photos) starts at this many characters, once typing pauses. */
const SMART_MIN = 3;
const SMART_SHOWN = 6;

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { data = EMPTY } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: q.trim().length > 0,
  });
  // Immich's smart search, a moment after typing stops (each search runs its machine learning).
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSettled(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const smart = useQuery({
    queryKey: ["smart-search", settled],
    queryFn: () => api.searchMedia(settled),
    enabled: open && settled.length >= SMART_MIN,
    retry: false,
    staleTime: 60_000,
  });
  const smartStatus = (smart.error as { status?: number } | null)?.status;
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
          {q.trim().length > 0 && total === 0 && !smart.data?.items.length && <div className="er-sub palette-hint">No matches.</div>}
          {settled.length >= SMART_MIN && settled === q.trim() && (smart.data?.items.length || smartStatus === 409) ? (
            <div className="palette-group">
              <div className="palette-group-label">In your photos</div>
              {smartStatus === 409 ? (
                <div className="er-sub palette-hint">Searching what's in photos needs Immich's machine learning, which is turned off on your Immich server.</div>
              ) : (
                <>
                  <div className="palette-smart">
                    {smart.data!.items.slice(0, SMART_SHOWN).map((m) => (
                      <button key={m.id} type="button" className="palette-smart-hit" aria-label={`Photo: ${m.caption || m.originalName}`} onClick={() => go(`/photos?photo=${m.id}`)}>
                        <img src={`${API_URL}${m.thumbUrl}`} alt="" />
                      </button>
                    ))}
                  </div>
                  <button type="button" className="palette-hit" onClick={() => go(`/photos?q=${encodeURIComponent(settled)}`)}>
                    <span className="palette-thumb placeholder" aria-hidden="true" />
                    <span>All photos of “{settled}”</span>
                  </button>
                </>
              )}
            </div>
          ) : null}
          {GROUPS.map((g) =>
            data[g.key].length > 0 ? (
              <div key={g.key} className="palette-group">
                <div className="palette-group-label">{g.label}</div>
                {data[g.key].map((hit) => (
                  <button key={hit.id} className="palette-hit" onClick={() => go(hit.to)}>
                    {hit.thumbUrl ? (
                      <img src={`${API_URL}${hit.thumbUrl}`} alt="" className="palette-thumb" />
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
