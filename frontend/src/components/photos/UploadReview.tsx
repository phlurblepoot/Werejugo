import { useEffect, useState } from "react";
import { api, type MediaSuggestions } from "../../api/client";

interface Props { mediaIds: string[]; onDone: () => void }

export function UploadReview({ mediaIds, onDone }: Props) {
  const [sug, setSug] = useState<MediaSuggestions | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => { api.getMediaSuggestions(mediaIds).then(setSug).catch(() => setSug({ trips: [], visits: [] })); }, [mediaIds]);

  async function applyTrip(tripId: string, ids: string[], key: string) {
    await api.applyMediaSuggestion({ mediaIds: ids, tripId });
    setDone((d) => new Set(d).add(key));
  }
  async function applyVisit(visitId: string, ids: string[], key: string) {
    await api.applyMediaSuggestion({ mediaIds: ids, visitId });
    setDone((d) => new Set(d).add(key));
  }

  const nothing = sug && sug.trips.length === 0 && sug.visits.length === 0;

  return (
    <div className="modal-backdrop" onClick={onDone}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Review suggestions</h2>
        {!sug && <div className="er-sub">Looking for matches…</div>}
        {nothing && <div className="er-sub">No automatic matches — you can link photos by hand anytime.</div>}

        {sug?.trips.map((t) => {
          const key = `t:${t.tripId}`;
          return (
            <div key={key} className="suggestion">
              <strong>{t.mediaIds.length} photos</strong> → trip <strong>{t.name}</strong> <span className="er-sub">by date</span>
              <div className="row" style={{ marginTop: 4 }}>
                {done.has(key) ? <span className="er-sub">Linked ✓</span> : (
                  <button className="primary" onClick={() => applyTrip(t.tripId, t.mediaIds, key)}>Link all</button>
                )}
              </div>
            </div>
          );
        })}

        {sug?.visits.map((v) => {
          const key = `v:${v.visitId}`;
          return (
            <div key={key} className="suggestion">
              <strong>{v.mediaIds.length} photos</strong> → near <strong>{v.title}</strong> <span className="er-sub">by GPS</span>
              <div className="row" style={{ marginTop: 4 }}>
                {done.has(key) ? <span className="er-sub">Tagged ✓</span> : (
                  <button className="primary" onClick={() => applyVisit(v.visitId, v.mediaIds, key)}>Tag visit</button>
                )}
              </div>
            </div>
          );
        })}

        <div className="er-sub" style={{ marginTop: 8 }}>People are tagged by hand in each photo.</div>
        <div className="modal-actions">
          <button className="primary" onClick={onDone}>Done</button>
        </div>
      </div>
    </div>
  );
}
