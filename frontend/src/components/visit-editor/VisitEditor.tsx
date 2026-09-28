import { useState } from "react";
import {
  api, type CustomIcon, type Item,
  type PathSettings, type PinSettings, type Theme,
} from "../../api/client";
import { ITEM_KINDS, KIND_LABELS } from "../../lib/style";
import { useVisitDraft, POINT_KINDS } from "./useVisitDraft";
import { PlaceForm } from "./PlaceForm";
import { FlightForm } from "./FlightForm";
import { CruiseForm } from "./CruiseForm";
import { DriveForm } from "./DriveForm";
import { AppearanceTab } from "./AppearanceTab";
import { VisitPhotos, type StagedPhoto } from "./VisitPhotos";
import { useUploads } from "../../lib/uploads/UploadsProvider";
import { useAutoRoute } from "./useAutoRoute";
import { newId } from "../../lib/newId";
import { formatDistance } from "../../lib/routing";

interface Props {
  item: Item | null;
  themes: Theme[];
  trips: { id: string; name: string }[];
  customIcons: CustomIcon[];
  /** Pick a spot on the map; null when picking was cancelled. */
  onRequestPick: () => Promise<[number, number] | null>;
  onCancelPick?: () => void;
  /** A saved place's photos changed (refresh the map; the editor stays open). */
  onPhotosChanged?: () => void;
  onClose: () => void;
  onSaved: () => void;
  onIconsChanged?: () => void;
  pinSettings?: PinSettings;
  pathSettings?: PathSettings;
}

export function VisitEditor(props: Props) {
  const { item, themes, trips, customIcons, onRequestPick, onClose, onSaved } = props;
  const editing = Boolean(item);
  const { draft, set, setKind, applyTheme, validate, buildPayload, inherited } = useVisitDraft(item, props.pinSettings, props.pathSettings, themes);
  const [tab, setTab] = useState<"details" | "appearance">("details");
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  // Set once the place exists (editing, or after the first save): later saves update it.
  const [savedId, setSavedId] = useState<string | null>(item?.id ?? null);
  // This new place's key: a create that's sent again (a retry) returns it instead of making another.
  const [clientKey] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"title" | "location" | null>(null);

  const isPoint = POINT_KINDS.includes(draft.kind);
  const uploads = useUploads();
  const { routing, note: routeNote } = useAutoRoute(draft, set);
  const routeLabel = { road: "by road", sea: "by sea", cruisemapper: "as sailed", photos: "from your photos", "great-circle": "", straight: "in straight lines" };

  async function pickOnMap() {
    setPicking(true);
    try {
      const at = await onRequestPick();
      if (at) set({ point: at });
    } finally {
      setPicking(false);
    }
  }

  async function save() {
    const err = validate();
    if (err) { setError(err.message); setErrorField(err.field); if (err.field === "title") setTab("details"); return; }
    setError(null); setErrorField(null);
    setBusy(true);
    try {
      const payload = buildPayload();
      const saved = savedId ? await api.updateItem(savedId, payload) : await api.createItem({ ...payload, clientKey });
      setSavedId(saved.id);
      // Staged photos upload in the background (the upload tray shows them);
      // the server links each one to the place when it arrives.
      if (staged.length) {
        uploads.add(staged.map((p) => ({ file: p.file, caption: p.caption })), { linkTo: `visit:${saved.id}`, linkRole: "appears_in" });
      }
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
        <div className="warnings pick-banner" role="status">
          Click on the map to set the location…
          <button type="button" onClick={() => props.onCancelPick?.()}>Cancel</button>
        </div>
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
            {ITEM_KINDS.map((k) => (
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
              <FlightForm draft={draft} set={set} />
            ) : draft.kind === "cruise" ? (
              <CruiseForm draft={draft} set={set} />
            ) : (
              <DriveForm stops={draft.stops} onChange={(stops) => set({ stops, routePath: null })} />
            )}

            {!isPoint && (routing || routeNote || draft.route?.distanceM) && (
              <div className="sub route-summary" role="status">
                {routing ? "Finding the route…" : draft.route?.distanceM ? `${formatDistance(draft.route.distanceM)} ${routeLabel[draft.route.source]}`.trim() : null}
                {!routing && routeNote && <div className="warnings">{routeNote}</div>}
              </div>
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
              onPhotosChanged={props.onPhotosChanged}
            />
          </>
        ) : (
          <AppearanceTab draft={draft} set={set} applyTheme={applyTheme} inherited={inherited} themes={themes} customIcons={customIcons} onIconsChanged={props.onIconsChanged} />
        )}

        {error && !errorField && <div className="error-text">{error}</div>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy || routing}>{busy ? "Saving…" : routing ? "Finding the route…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
