import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ItineraryItem, type Trip } from "../../api/client";
import { RelatedPanel } from "../shared/RelatedPanel";
import { DocumentList } from "../documents/DocumentList";
import { TripPacking } from "../packing/TripPacking";
import { ShareButton } from "../shared/ShareButton";

type Status = "idea" | "planning" | "booked" | "done";
const STATUSES: Status[] = ["idea", "planning", "booked", "done"];

export function TripDetail({ trip, onClose, onChanged }: { trip: Trip; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const itinKey = ["itinerary", trip.id];
  const { data: items = [] } = useQuery({ queryKey: itinKey, queryFn: () => api.listItinerary(trip.id) });
  const { data: docs = [] } = useQuery({ queryKey: ["documents", { owner: `trip:${trip.id}` }], queryFn: () => api.listDocuments({ owner: `trip:${trip.id}` }) });

  const refetchItin = () => qc.invalidateQueries({ queryKey: itinKey });
  const add = useMutation({ mutationFn: (title: string) => api.createItineraryItem(trip.id, { title }), onSuccess: () => { setNewTitle(""); refetchItin(); } });
  const del = useMutation({ mutationFn: (id: string) => api.deleteItineraryItem(id), onSuccess: refetchItin });
  const schedule = useMutation({ mutationFn: (id: string) => api.updateItineraryItem(id, { scheduledOn: new Date().toISOString().slice(0, 10) }), onSuccess: refetchItin });
  const convert = useMutation({ mutationFn: (id: string) => api.convertItineraryItem(id), onSuccess: () => { refetchItin(); onChanged(); } });

  async function setStatus(status: Status) { await api.updateTrip(trip.id, { status }); onChanged(); }

  const scheduled = items.filter((i) => i.scheduledOn);
  const wishlist = items.filter((i) => !i.scheduledOn);

  const itinRow = (i: ItineraryItem, scheduledView: boolean) => (
    <div key={i.id} className="itin-item">
      {scheduledView && <span className="day">{i.scheduledOn}</span>}
      <span className="t">{i.title}</span>
      {i.convertedVisitId ? <span className="chip">✓ visit</span>
        : scheduledView ? <button aria-label={`Convert ${i.title} to a visit`} onClick={() => convert.mutate(i.id)}>→ visit</button>
        : <button onClick={() => schedule.mutate(i.id)}>schedule</button>}
      <button className="ghost" aria-label={`Delete ${i.title}`} onClick={() => del.mutate(i.id)}>✕</button>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ flex: 1 }}>{trip.name}</h2>
          <ShareButton targetType="trip" targetId={trip.id} label="Share" />
          <select value={trip.status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="ghost" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="er-sub" style={{ marginBottom: 8 }}>{trip.startDate ? `${trip.startDate} – ${trip.endDate ?? "?"}` : "no dates"}</div>

        <div className="section-title"><span>🗺️ Itinerary</span></div>
        {scheduled.map((i) => itinRow(i, true))}
        {scheduled.length === 0 && <div className="er-sub">Nothing scheduled yet.</div>}

        <div className="section-title"><span>💡 Wishlist</span></div>
        {wishlist.map((i) => itinRow(i, false))}
        <div className="row" style={{ marginTop: 6 }}>
          <input value={newTitle} placeholder="Add an idea or stop…" onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newTitle.trim() && add.mutate(newTitle.trim())} />
          <button style={{ flex: "0 0 auto" }} disabled={!newTitle.trim()} onClick={() => newTitle.trim() && add.mutate(newTitle.trim())}>Add</button>
        </div>

        <div className="section-title"><span>🛂 Bookings</span></div>
        {docs.length > 0 ? <DocumentList documents={docs} onOpen={() => {}} /> : <div className="er-sub">No documents attached to this trip.</div>}

        <div className="section-title"><span>🎒 Packing</span></div>
        <TripPacking trip={trip} />

        <div className="section-title"><span>👥 Travelers</span></div>
        <RelatedPanel entity={`trip:${trip.id}`} addTypes={["person"]} />

        <div className="modal-actions"><button className="primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
