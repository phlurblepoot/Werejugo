import { useState } from "react";
import { api, type Trip } from "../../api/client";

type Status = "idea" | "planning" | "booked" | "done";
const STATUSES: Status[] = ["idea", "planning", "booked", "done"];

export function TripForm({ trip, onClose, onSaved }: { trip: Trip | null; onClose: () => void; onSaved: () => void }) {
  const editing = Boolean(trip);
  const [name, setName] = useState(trip?.name ?? "");
  const [status, setStatus] = useState<Status>(trip?.status ?? "idea");
  const [startDate, setStartDate] = useState(trip?.startDate ?? "");
  const [endDate, setEndDate] = useState(trip?.endDate ?? "");
  const [color, setColor] = useState(trip?.color ?? "#2563eb");
  const [description, setDescription] = useState(trip?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError("Please enter a name."); return; }
    setBusy(true); setError(null);
    const data = { name: name.trim(), status, startDate: startDate || null, endDate: endDate || null, color, description };
    try {
      if (editing && trip) await api.updateTrip(trip.id, data);
      else await api.createTrip("", data);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() { if (trip) { await api.deleteTrip(trip.id); onSaved(); } }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? "Edit trip" : "New trip"}</h2>
        <div className="field"><label>Name</label><input value={name} placeholder="e.g. Italy 2025" onChange={(e) => setName(e.target.value)} /></div>
        <div className="row">
          <div className="field"><label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field"><label>Color</label><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></div>
        </div>
        <div className="row">
          <div className="field"><label>Start</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="field"><label>End</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        <div className="field"><label>Notes</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          {editing && <button className="danger" style={{ marginRight: "auto" }} onClick={remove}>Delete</button>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
