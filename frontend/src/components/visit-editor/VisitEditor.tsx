import { useState } from "react";
import {
  api, type CustomIcon, type Item, type ItemKind, type LookupResult, type MapSet,
  type PathSettings, type PinSettings, type Theme,
} from "../../api/client";
import { KIND_LABELS } from "../../lib/style";
import { useVisitDraft, POINT_KINDS } from "./useVisitDraft";
import { PlaceForm } from "./PlaceForm";
import { FlightForm } from "./FlightForm";
import { CruiseForm } from "./CruiseForm";
import { DriveForm } from "./DriveForm";
import { AppearanceTab } from "./AppearanceTab";
import { VisitPhotos, type StagedPhoto } from "./VisitPhotos";

interface Props {
  mapSet: MapSet;
  item: Item | null;
  themes: Theme[];
  trips: { id: string; name: string }[];
  customIcons: CustomIcon[];
  onRequestPick: () => Promise<[number, number]>;
  onClose: () => void;
  onSaved: () => void;
  onIconsChanged?: () => void;
  pinSettings?: PinSettings;
  pathSettings?: PathSettings;
}

const KINDS: ItemKind[] = ["place", "food", "flight", "cruise", "drive", "custom"];

export function VisitEditor(props: Props) {
  const { mapSet, item, themes, trips, customIcons, onRequestPick, onClose, onSaved } = props;
  const editing = Boolean(item);
  const { draft, set, setKind, applyTheme, validate, buildPayload } = useVisitDraft(item, props.pinSettings, props.pathSettings);
  const [tab, setTab] = useState<"details" | "appearance">("details");
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const savedId = item?.id ?? null; // non-null only when editing an existing visit
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"title" | "location" | null>(null);
  const [flightResult, setFlightResult] = useState<LookupResult | null>(null);

  const isPoint = POINT_KINDS.includes(draft.kind);

  async function pickOnMap() {
    setPicking(true);
    try { const [lng, lat] = await onRequestPick(); set({ point: [lng, lat] }); }
    finally { setPicking(false); }
  }

  function applyFlight(r: LookupResult) {
    setFlightResult(r);
    if (r.title && !draft.title) set({ title: r.title });
    set({ stops: r.waypoints.map((w, i) => ({ label: w.label, kind: (w.kind as any) ?? "stop", lng: w.lng, lat: w.lat, seq: i })) });
  }

  async function save() {
    const err = validate();
    if (err) { setError(err.message); setErrorField(err.field); if (err.field === "title") setTab("details"); return; }
    setError(null); setErrorField(null);
    setBusy(true);
    try {
      const payload = buildPayload();
      const saved = editing && item ? await api.updateItem(item.id, payload) : await api.createItem(mapSet.id, payload);
      // Upload any staged photos in parallel, then link each to the saved visit.
      await Promise.all(staged.map(async (p) => {
        const m = await api.uploadMedia(p.file, p.caption);
        await api.createLink(`media:${m.id}`, `visit:${saved.id}`, "appears_in");
      }));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (picking) {
    return (
      <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1100 }}>
        <div className="warnings">Click on the map to set the location…</div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? "Edit item" : "Add to map"}</h2>

        <div className="field">
          <label>Type</label>
          <div className="add-buttons">
            {KINDS.map((k) => (
              <button key={k} className={k === draft.kind ? "primary" : ""} onClick={() => setKind(k)}>{KIND_LABELS[k]}</button>
            ))}
          </div>
        </div>

        <div className="tabs">
          <button type="button" className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}>Details</button>
          <button type="button" className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}>Appearance</button>
        </div>

        {tab === "details" ? (
          <>
            <div className="field">
              <label>Title</label>
              <input value={draft.title} placeholder="e.g. Anniversary dinner" onChange={(e) => set({ title: e.target.value })} />
              {errorField === "title" && error && <div className="error-text">{error}</div>}
            </div>

            {errorField === "location" && error && <div className="error-text">{error}</div>}

            {isPoint ? (
              <PlaceForm
                point={draft.point}
                onPick={pickOnMap}
                onSelect={(lng, lat, label) => { set({ point: [lng, lat] }); if (!draft.title) set({ title: label }); }}
                onPhotoLocation={(lat, lng, date) => { set({ point: [lng, lat] }); if (date && !draft.occurredOn) set({ occurredOn: date }); }}
              />
            ) : draft.kind === "flight" ? (
              <FlightForm onResult={applyFlight} />
            ) : draft.kind === "cruise" ? (
              <CruiseForm draft={draft} set={set} />
            ) : (
              <DriveForm stops={draft.stops} onChange={(stops) => set({ stops, routePath: null })} />
            )}

            {draft.kind === "flight" && flightResult && flightResult.warnings.length > 0 && (
              <div className="warnings">{flightResult.warnings.map((w, i) => <div key={i}>• {w}</div>)}</div>
            )}

            {draft.kind !== "cruise" && (
              <div className="field">
                <label>Date (optional)</label>
                <input type="date" value={draft.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} />
              </div>
            )}

            <div className="field">
              <label>Trip</label>
              <select value={draft.tripId ?? ""} onChange={(e) => set({ tripId: e.target.value || null })}>
                <option value="">— No trip —</option>
                {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div className="field">
              <label>Notes</label>
              <textarea value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
            </div>

            <VisitPhotos
              visitId={savedId}
              existing={item?.photos ?? []}
              staged={staged}
              onStaged={setStaged}
              onExistingChanged={onSaved}
            />
          </>
        ) : (
          <AppearanceTab draft={draft} set={set} applyTheme={applyTheme} themes={themes} customIcons={customIcons} onIconsChanged={props.onIconsChanged} />
        )}

        {error && !errorField && <div className="error-text">{error}</div>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
