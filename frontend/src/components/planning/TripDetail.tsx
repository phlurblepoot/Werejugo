import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ItineraryItem, type Trip } from "../../api/client";
import { RelatedPanel } from "../shared/RelatedPanel";
import { DocumentList } from "../documents/DocumentList";
import { TripPacking } from "../packing/TripPacking";
import { ShareButton } from "../shared/ShareButton";
import { ByFamily, otherFamily } from "../shared/ByFamily";
import { formatDate, formatDateRange } from "../../lib/dates";
import { useAuth } from "../../lib/auth";
import { TripFamilies, ROLE_LABEL } from "./TripFamilies";
import { TripActivity } from "./TripActivity";
import { PhotoPicker } from "../photos/PhotoPicker";

type Status = "idea" | "planning" | "booked" | "done";
const STATUSES: Status[] = ["idea", "planning", "booked", "done"];

export function TripDetail({ trip, onClose, onChanged }: { trip: Trip; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  // Only the host family changes the trip itself (status, sharing); guests add to it.
  const role = trip.role ?? "host";
  const isHost = role === "host";
  const shared = trip.shared ?? false;
  const [newTitle, setNewTitle] = useState("");
  const [picking, setPicking] = useState<{ entity: string; uploadLinkTo: string } | null>(null);
  const photos = useQuery({ queryKey: ["media", "timeline", { trip: trip.id }], queryFn: () => api.mediaTimeline({ trip: trip.id }) });
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

  const itinRow = (i: ItineraryItem, scheduledView: boolean) => {
    const canEdit = i.canEdit !== false;
    return (
      <div key={i.id} className="itin-item">
        {scheduledView && <span className="day">{formatDate(i.scheduledOn)}</span>}
        <span className="t">{i.title} <ByFamily name={otherFamily(i, user?.familyId)} /></span>
        {i.convertedVisitId ? <span className="chip">✓ visit</span>
          : !canEdit ? null
          : scheduledView ? <button aria-label={`Convert ${i.title} to a visit`} onClick={() => convert.mutate(i.id)}>→ visit</button>
          : <button onClick={() => schedule.mutate(i.id)}>schedule</button>}
        {scheduledView && (
          <button className="ghost" aria-label={`Add photos to ${i.title}`} title="Add photos"
            onClick={() => setPicking({ entity: `itinerary:${i.id}`, uploadLinkTo: i.convertedVisitId ? `visit:${i.convertedVisitId}` : `trip:${trip.id}` })}>📷</button>
        )}
        {canEdit && <button className="ghost" aria-label={`Delete ${i.title}`} onClick={() => del.mutate(i.id)}>✕</button>}
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="trip-head">
          <h2>{trip.name}</h2>
          <button className="ghost" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="trip-meta">
          <span className="er-sub">{trip.startDate ? formatDateRange(trip.startDate, trip.endDate) : "no dates"}</span>
          {isHost ? (
            <>
              <ShareButton targetType="trip" targetId={trip.id} label="Share" />
              <select aria-label="Status" className="trip-status" value={trip.status} onChange={(e) => setStatus(e.target.value as Status)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </>
          ) : (
            <ByFamily prefix={`${ROLE_LABEL[role]} · hosted by `} name={trip.hostFamilyName} title={`Hosted by ${trip.hostFamilyName}`} />
          )}
        </div>

        <div className="section-title"><span>📷 Photos</span></div>
        <div className="row trip-photos">
          <span className="er-sub">
            {photos.data ? (photos.data.total ? `${photos.data.total} ${photos.data.total === 1 ? "photo" : "photos"}` : "No photos yet") : "…"}
          </span>
          {!!photos.data?.total && <Link className="btn-link" to={`/photos?trip=${trip.id}`}>Open album</Link>}
          <button type="button" onClick={() => setPicking({ entity: `trip:${trip.id}`, uploadLinkTo: `trip:${trip.id}` })}>Add photos</button>
        </div>

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

        <div className="section-title"><span>👨‍👩‍👧 Families</span></div>
        <TripFamilies tripId={trip.id} tripName={trip.name} onLeft={() => { onChanged(); onClose(); }} />

        {shared && (
          <>
            <div className="section-title"><span>🕑 Activity</span></div>
            <TripActivity tripId={trip.id} />
          </>
        )}

        <div className="section-title"><span>🛂 Bookings{shared && <span className="private-note">only your family sees these</span>}</span></div>
        {docs.length > 0 ? <DocumentList documents={docs} onOpen={() => {}} /> : <div className="er-sub">No documents attached to this trip.</div>}

        <div className="section-title"><span>🎒 Packing{shared && <span className="private-note">only your family sees this</span>}</span></div>
        <TripPacking trip={trip} />

        <div className="section-title"><span>👥 Travelers</span></div>
        <RelatedPanel entity={`trip:${trip.id}`} addTypes={["person"]} />

        <div className="modal-actions"><button className="primary" onClick={onClose}>Done</button></div>
        {picking && <PhotoPicker entity={picking.entity} uploadLinkTo={picking.uploadLinkTo} onClose={() => setPicking(null)} />}
      </div>
    </div>
  );
}
