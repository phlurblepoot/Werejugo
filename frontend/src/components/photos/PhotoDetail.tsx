import { api, API_URL, type MediaItem } from "../../api/client";
import { RelatedPanel } from "../shared/RelatedPanel";

interface Props {
  item: MediaItem;
  trips: { id: string; name: string }[];
  onChanged: () => void;
  onClose: () => void;
}

export function PhotoDetail({ item, trips, onChanged, onClose }: Props) {
  async function saveCaption(caption: string) {
    if (caption === item.caption) return;
    await api.updatePhoto(item.id, caption);
    onChanged();
  }
  async function setTrip(tripId: string | null) {
    await api.setMediaTrip(item.id, tripId);
    onChanged();
  }
  async function remove() {
    await api.deletePhoto(item.id);
    onChanged();
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="ghost" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <img className="photo-detail-img" src={`${API_URL}${item.url}`} alt={item.caption || "Photo"} />

        <div className="field">
          <label>Caption</label>
          <input defaultValue={item.caption} placeholder="Caption…" onBlur={(e) => saveCaption(e.target.value)} />
        </div>

        <div className="field">
          <label>Trip</label>
          <select defaultValue={item.tripId ?? ""} onChange={(e) => setTrip(e.target.value || null)}>
            <option value="">— No trip —</option>
            {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="er-sub" style={{ marginBottom: 8 }}>
          {item.takenAt ? `🕒 ${item.takenAt.slice(0, 10)}` : "🕒 No date"}
          {item.lat != null && item.lng != null ? ` · 📍 ${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}` : ""}
        </div>

        <RelatedPanel entity={`media:${item.id}`} addTypes={["person", "visit"]} />

        <div className="modal-actions">
          <button className="danger" style={{ marginRight: "auto" }} onClick={remove}>Delete</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
