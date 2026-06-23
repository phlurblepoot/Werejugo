import { useState } from "react";
import type { MediaFilters } from "../../api/client";
import { EntityPicker } from "../shared/EntityPicker";

interface Props {
  value: MediaFilters;
  onChange: (f: MediaFilters) => void;
  trips: { id: string; name: string }[];
}

export function PhotoFilters({ value, onChange, trips }: Props) {
  const [labels, setLabels] = useState<{ person?: string; visit?: string }>({});

  const set = (patch: Partial<MediaFilters>) => onChange({ ...value, ...patch });

  return (
    <div className="photo-filter-bar">
      {value.person ? (
        <span className="fchip act">👤 {labels.person ?? "Person"}
          <button aria-label="Clear person filter" onClick={() => set({ person: undefined })}>✕</button>
        </span>
      ) : (
        <EntityPicker type="person" placeholder="Filter by person…" onPick={(e) => { setLabels((l) => ({ ...l, person: e.label })); set({ person: e.id }); }} />
      )}

      <select value={value.trip ?? ""} onChange={(e) => set({ trip: e.target.value || undefined })}>
        <option value="">✈️ Any trip</option>
        {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {value.visit ? (
        <span className="fchip act">📍 {labels.visit ?? "Place"}
          <button aria-label="Clear place filter" onClick={() => set({ visit: undefined })}>✕</button>
        </span>
      ) : (
        <EntityPicker type="visit" placeholder="Filter by place…" onPick={(e) => { setLabels((l) => ({ ...l, visit: e.label })); set({ visit: e.id }); }} />
      )}

      <input type="date" value={value.from ?? ""} title="From" onChange={(e) => set({ from: e.target.value || undefined })} />
      <input type="date" value={value.to ?? ""} title="To" onChange={(e) => set({ to: e.target.value || undefined })} />
    </div>
  );
}
