import { useState } from "react";
import { api, type Trip } from "../api/client";
import { PALETTE } from "./StylePicker";
import { useToast } from "./Toast";

interface Props {
  mapSetId: string;
  trips: Trip[];
  onClose: () => void;
  onChanged: () => void;
}

const blank = { name: "", description: "", startDate: "", endDate: "", color: PALETTE[0] };

export function TripsPanel({ mapSetId, trips, onClose, onChanged }: Props) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<typeof blank>(blank);
  const [busy, setBusy] = useState(false);

  function startNew() {
    setEditing("new");
    setForm(blank);
  }
  function startEdit(t: Trip) {
    setEditing(t.id);
    setForm({
      name: t.name,
      description: t.description,
      startDate: t.startDate ?? "",
      endDate: t.endDate ?? "",
      color: t.color,
    });
  }

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        color: form.color,
      };
      const isNew = editing === "new";
      if (isNew) await api.createTrip(mapSetId, payload);
      else if (editing) await api.updateTrip(editing, payload);
      setEditing(null);
      onChanged();
      toast(isNew ? `Trip “${payload.name}” created` : "Trip updated", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save trip", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this trip? Items will be unassigned but not deleted.")) return;
    try {
      await api.deleteTrip(id);
      onChanged();
      toast("Trip deleted", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete trip", "error");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Trips</h2>
        {trips.length === 0 && <div className="empty">No trips yet. Group items into a vacation or outing.</div>}
        {trips.map((t) => (
          <div key={t.id} className="item-row">
            <div className="badge" style={{ background: t.color }}>✈</div>
            <div className="meta">
              <div className="title">{t.name}</div>
              <div className="sub">
                {t.startDate ?? "?"}{t.endDate ? ` – ${t.endDate}` : ""}
              </div>
            </div>
            <button className="ghost" onClick={() => startEdit(t)} aria-label={`Edit ${t.name}`} title="Edit trip">✎</button>
            <button className="ghost" onClick={() => remove(t.id)} aria-label={`Delete ${t.name}`} title="Delete trip">✕</button>
          </div>
        ))}

        {editing ? (
          <>
            <div className="section-title"><span>{editing === "new" ? "New trip" : "Edit trip"}</span></div>
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Italy 2025" />
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Start</label>
                <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>End</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="field">
              <label>Color</label>
              <div className="swatches">
                {PALETTE.map((c) => (
                  <div key={c} className={`swatch ${c === form.color ? "active" : ""}`} style={{ background: c }} onClick={() => setForm({ ...form, color: c })} />
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save trip"}</button>
            </div>
          </>
        ) : (
          <div className="modal-actions">
            <button onClick={onClose}>Done</button>
            <button className="primary" onClick={startNew}>+ New trip</button>
          </div>
        )}
      </div>
    </div>
  );
}
