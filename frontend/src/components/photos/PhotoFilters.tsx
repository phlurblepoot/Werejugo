import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type MediaFilters } from "../../api/client";
import { EntityPicker } from "../shared/EntityPicker";

interface Props {
  value: MediaFilters;
  onChange: (f: MediaFilters) => void;
  trips: { id: string; name: string }[];
}

export function PhotoFilters({ value, onChange, trips }: Props) {
  const [labels, setLabels] = useState<{ person?: string; visit?: string }>({});
  // A person filter that came in the address (/photos?person=…, from their page) needs their name.
  const { data: personName } = useQuery({
    queryKey: ["person", value.person],
    queryFn: () => api.getPerson(value.person!),
    enabled: !!value.person && !labels.person,
    select: (p) => p.displayName,
  });

  const set = (patch: Partial<MediaFilters>) => onChange({ ...value, ...patch });

  return (
    <div className="photo-filter-bar">
      {value.person ? (
        <span className="fchip act">👤 {labels.person ?? personName ?? "Person"}
          <button aria-label="Clear person filter" onClick={() => set({ person: undefined })}>✕</button>
        </span>
      ) : (
        <EntityPicker type="person" placeholder="Filter by person…" onPick={(e) => { setLabels((l) => ({ ...l, person: e.label })); set({ person: e.id }); }} />
      )}

      <select aria-label="Trip" value={value.trip ?? ""} onChange={(e) => set({ trip: e.target.value || undefined, noTrip: undefined })}>
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

      <input type="date" value={value.from ?? ""} title="From" aria-label="From" onChange={(e) => set({ from: e.target.value || undefined })} />
      <input type="date" value={value.to ?? ""} title="To" aria-label="To" onChange={(e) => set({ to: e.target.value || undefined })} />

      <select aria-label="Photos or videos" value={value.kind ?? ""} onChange={(e) => set({ kind: (e.target.value || undefined) as MediaFilters["kind"] })}>
        <option value="">Photos &amp; videos</option>
        <option value="image">Photos</option>
        <option value="video">Videos</option>
      </select>
      <button type="button" className={`fchip${value.noTrip ? " act" : ""}`} aria-pressed={!!value.noTrip}
        onClick={() => set({ noTrip: value.noTrip ? undefined : "1", trip: undefined })}>No trip</button>
      <button type="button" className={`fchip${value.hidden ? " act" : ""}`} aria-pressed={!!value.hidden}
        onClick={() => set({ hidden: value.hidden ? undefined : "only" })}>Hidden</button>
    </div>
  );
}
