import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export function BlackoutManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: blackouts = [] } = useQuery({ queryKey: ["blackouts"], queryFn: api.listBlackouts });
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refetch = () => qc.invalidateQueries({ queryKey: ["blackouts"] });
  const add = useMutation({
    mutationFn: () => api.createBlackout({ label: label.trim(), startDate, endDate }),
    onSuccess: () => { setLabel(""); setStartDate(""); setEndDate(""); setError(null); refetch(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not add"),
  });
  const del = useMutation({ mutationFn: (id: string) => api.deleteBlackout(id), onSuccess: refetch });

  function submit() {
    if (!label.trim() || !startDate || !endDate) { setError("Label and both dates are required."); return; }
    add.mutate();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Blackout dates</h2>
        <p className="er-sub">Periods when travel isn't possible (school, work). They show on the timeline.</p>
        {blackouts.map((b) => (
          <div key={b.id} className="itin-item">
            <span className="t">{b.label}</span>
            <span className="er-sub">{b.startDate} – {b.endDate}</span>
            <button className="ghost" aria-label={`Delete ${b.label}`} onClick={() => del.mutate(b.id)}>✕</button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <input value={label} placeholder="Label (e.g. School 2025-26)" onChange={(e) => setLabel(e.target.value)} />
          <input type="date" aria-label="Blackout start" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input type="date" aria-label="Blackout end" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={submit} disabled={add.isPending}>Add blackout</button>
        </div>
      </div>
    </div>
  );
}
