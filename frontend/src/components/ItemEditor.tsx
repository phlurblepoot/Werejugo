import { useEffect, useState } from "react";
import {
  api,
  type CruiseFindResult,
  type CruiseSailing,
  type CustomIcon,
  type Geometry,
  type Item,
  type ItemKind,
  type LookupResult,
  type MapSet,
  type Photo,
  type Theme,
  type Trip,
  type Waypoint,
} from "../api/client";
import { KIND_LABELS, defaultColor, defaultIcon, defaultPinStyle, defaultPathStyle } from "../lib/style";
import { buildRoutePath, type LngLat } from "../lib/geo";
import { StylePicker } from "./StylePicker";
import { PinStyleControls, type PinShapeVals } from "./PinStyleControls";
import { PathStyleControls, type PathVals } from "./PathStyleControls";
import { PlaceSearch } from "./PlaceSearch";
import { StopBuilder } from "./StopBuilder";
import { Autocomplete } from "./Autocomplete";
import { MediaThumb } from "./MediaThumb";
import type { PathSettings, PinSettings, PinStyle, PathStyle } from "../api/client";

interface Props {
  mapSet: MapSet;
  item: Item | null;
  themes: Theme[];
  trips: Trip[];
  customIcons: CustomIcon[];
  onRequestPick: () => Promise<[number, number]>;
  onClose: () => void;
  onSaved: () => void;
  onIconsChanged?: () => void;
  pinSettings?: PinSettings;
  pathSettings?: PathSettings;
}

const POINT_KINDS: ItemKind[] = ["place", "food", "custom"];

/** Shift an ISO datetime by a millisecond offset (used to realign reused itineraries). */
function shiftIso(iso: string | null, offsetMs: number): string | null {
  if (!iso || offsetMs === 0) return iso;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t + offsetMs).toISOString();
}

export function ItemEditor({ mapSet, item, themes, trips, customIcons, onRequestPick, onClose, onSaved, onIconsChanged, pinSettings, pathSettings }: Props) {
  const editing = Boolean(item);
  const initialKind = item?.kind ?? "place";
  const [kind, setKind] = useState<ItemKind>(initialKind);
  const [title, setTitle] = useState(item?.title ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [occurredOn, setOccurredOn] = useState(item?.occurredOn ?? "");
  const [themeId, setThemeId] = useState<string | null>(item?.themeId ?? null);
  const [tripId, setTripId] = useState<string | null>(item?.tripId ?? null);
  const [color, setColor] = useState(item?.color ?? defaultColor(initialKind, pinSettings));
  const [icon, setIcon] = useState(item?.icon ?? defaultIcon(initialKind, pinSettings));
  // Per-item pin shape/size/border, prefilled from settings defaults.
  const initialPin = (item?.properties?.pin ?? {}) as PinStyle;
  const initialPinBase = defaultPinStyle(initialKind, pinSettings);
  const [pinStyle, setPinStyle] = useState<PinShapeVals>({
    size: initialPin.size ?? initialPinBase.size,
    shape: initialPin.shape ?? initialPinBase.shape,
    borderWidth: initialPin.borderWidth ?? initialPinBase.borderWidth,
    borderColor: initialPin.borderColor ?? initialPinBase.borderColor,
  });

  // Trail (path) style for route kinds, prefilled from settings defaults.
  const initialPathOverride = (item?.properties?.path ?? {}) as PathStyle;
  const initialPathBase = defaultPathStyle(initialKind, pathSettings);
  const [pathVals, setPathVals] = useState<PathVals>({
    style: initialPathOverride.style ?? initialPathBase.style,
    color: initialPathOverride.color ?? initialPathBase.color,
    width: initialPathOverride.width ?? initialPathBase.width,
    imageUrl: initialPathOverride.imageUrl ?? initialPathBase.imageUrl,
  });

  const initialPoint =
    item?.geometry?.type === "Point" ? (item.geometry.coordinates as number[]) : null;
  const [point, setPoint] = useState<[number, number] | null>(
    initialPoint ? [initialPoint[0], initialPoint[1]] : null,
  );

  const [stops, setStops] = useState<Waypoint[]>(item?.waypoints ?? []);
  // Explicit route polyline (e.g. CruiseMapper's actual sailed track). When null,
  // the route is derived from the stops (great-circle for flights/cruises).
  const [routePath, setRoutePath] = useState<number[][] | null>(
    item?.geometry?.type === "LineString" ? (item.geometry.coordinates as number[][]) : null,
  );
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lookupImage, setLookupImage] = useState<string | null>(null);

  const props0 = (item?.properties ?? {}) as Record<string, string>;
  const [cruiseLine, setCruiseLine] = useState(props0.cruiseLine ?? "");
  const [ship, setShip] = useState(props0.ship ?? "");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [cruiseResult, setCruiseResult] = useState<CruiseFindResult | null>(null);
  const [shipUrl, setShipUrl] = useState<string | null>(null);
  const [lineConfirmed, setLineConfirmed] = useState<boolean>(!!props0.cruiseLine);
  const [shipConfirmed, setShipConfirmed] = useState<boolean>(!!props0.ship);
  // When reusing a repeating itinerary for a past/different sailing, keep the
  // user's chosen start date and shift the itinerary's port dates onto it.
  const [reuseItinerary, setReuseItinerary] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);

  const [existingPhotos, setExistingPhotos] = useState<Photo[]>(item?.photos ?? []);
  const [pendingPhotos, setPendingPhotos] = useState<{ file: File; caption: string; preview: string }[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const isPoint = POINT_KINDS.includes(kind);

  // Release object URLs for staged previews when the editor unmounts.
  useEffect(() => {
    return () => pendingPhotos.forEach((p) => URL.revokeObjectURL(p.preview));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(files: FileList) {
    const next = Array.from(files).map((file) => ({
      file,
      caption: "",
      preview: URL.createObjectURL(file),
    }));
    setPendingPhotos((prev) => [...prev, ...next]);
  }

  function removePending(index: number) {
    setPendingPhotos((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function deleteExisting(id: string) {
    await api.deletePhoto(id);
    setExistingPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  async function saveCaption(id: string, caption: string) {
    setExistingPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, caption } : p)));
    await api.updatePhoto(id, caption);
  }

  function applyKind(k: ItemKind) {
    setKind(k);
    if (!themeId) {
      setColor(defaultColor(k, pinSettings));
      setIcon(defaultIcon(k, pinSettings));
    }
    setPinStyle(defaultPinStyle(k, pinSettings));
    setPathVals(defaultPathStyle(k, pathSettings));
  }

  function applyTheme(id: string | null) {
    setThemeId(id);
    const t = themes.find((x) => x.id === id);
    if (t) {
      setColor(t.color);
      setIcon(t.icon);
    }
  }

  async function pickOnMap() {
    setPicking(true);
    try {
      const [lng, lat] = await onRequestPick();
      setPoint([lng, lat]);
    } finally {
      setPicking(false);
    }
  }

  function applyLookup(r: LookupResult) {
    if (r.title && !title) setTitle(r.title);
    setStops(
      r.waypoints.map((w, i) => ({
        label: w.label,
        kind: (w.kind as Waypoint["kind"]) ?? "stop",
        lng: w.lng,
        lat: w.lat,
        seq: i,
      })),
    );
    setWarnings(r.warnings);
    setLookupImage(r.image ?? null);
  }

  // Import a CruiseMapper image (ship photo or line logo) and use it as the pin.
  async function useImageAsPin(url: string) {
    setPinBusy(true);
    try {
      const r = await api.uploadFromUrl(url);
      setIcon(r.thumbUrl || r.url);
    } catch {
      setWarnings(["Couldn't import that image as a pin."]);
    } finally {
      setPinBusy(false);
    }
  }

  async function findCruise() {
    if (!ship.trim()) {
      setWarnings(["Enter or pick a ship to search CruiseMapper."]);
      return;
    }
    setLookupBusy(true);
    try {
      const res = await api.findCruise({
        line: cruiseLine.trim() || undefined,
        ship: ship.trim() || undefined,
        shipUrl: shipUrl || undefined,
      });
      setCruiseResult(res);
      setWarnings(res.warnings);
      setLookupImage(res.image ?? null);
      // Auto-select the sailing closest to the entered date — but not when reusing
      // an itinerary, where the user deliberately picks the route that matches theirs.
      const dated = res.sailings.filter((s) => s.dateISO);
      const target = occurredOn ? Date.parse(occurredOn) : NaN;
      if (!reuseItinerary && dated.length && !Number.isNaN(target)) {
        const closest = dated.reduce((best, s) =>
          Math.abs(Date.parse(s.dateISO!) - target) < Math.abs(Date.parse(best.dateISO!) - target) ? s : best,
        );
        pickSailing(closest);
      }
    } finally {
      setLookupBusy(false);
    }
  }

  // Manual edits to the stop list invalidate any explicit (cruise) route.
  function changeStops(next: Waypoint[]) {
    setStops(next);
    setRoutePath(null);
  }

  function addStop(label: string, lng: number, lat: number) {
    setRoutePath(null);
    setStops((prev) => {
      const next = [...prev, { label, kind: "stop" as const, lng, lat, seq: prev.length }];
      return next.map((s, i) => ({
        ...s,
        seq: i,
        kind: i === 0 ? "origin" : i === next.length - 1 ? "destination" : "stop",
      }));
    });
  }

  async function addPortChip(label: string, lng: number | null, lat: number | null) {
    if (lng != null && lat != null) {
      addStop(label, lng, lat);
      return;
    }
    try {
      const p = await api.resolvePort(label);
      addStop(p.label, p.lng, p.lat);
    } catch {
      setWarnings([`Couldn't locate "${label}" — try the search box below.`]);
    }
  }

  async function pickSailing(s: CruiseSailing) {
    if (!title.trim()) setTitle(`${cruiseResult?.shipName || ship} — ${s.title}`.trim());
    // Reuse mode keeps the user's start date; otherwise adopt the sailing's date.
    if (!reuseItinerary && s.dateISO) setOccurredOn(s.dateISO);
    // Days to shift the itinerary's dates onto the user's chosen start date.
    const offsetMs = reuseItinerary && occurredOn && s.dateISO ? Date.parse(occurredOn) - Date.parse(s.dateISO) : 0;
    if (!s.id) {
      if (s.departurePort) addPortChip(s.departurePort, null, null);
      return;
    }
    setLookupBusy(true);
    try {
      const d = await api.getSailingDetail(s.id);
      if (d.ports.length) {
        // Plot every port on its date, and use the real sailed route.
        setStops(
          d.ports.map((p, i) => {
            // departAt must be a full datetime (backend validates it); a date-only
            // fallback becomes midnight, which the formatter renders as just the date.
            const baseDepart = p.departAt ?? (p.dateISO ? `${p.dateISO}T00:00:00.000Z` : null);
            return {
              label: p.label,
              kind: p.kind,
              lng: p.lng,
              lat: p.lat,
              seq: i,
              arriveAt: shiftIso(p.arriveAt ?? null, offsetMs),
              departAt: shiftIso(baseDepart, offsetMs),
            };
          }),
        );
        setRoutePath(d.path && d.path.length >= 2 ? d.path : null);
        if (d.warnings.length) setWarnings(d.warnings);
      } else {
        setWarnings(d.warnings.length ? d.warnings : ["Couldn't read that sailing's ports — add them manually below."]);
        if (s.departurePort) addPortChip(s.departurePort, null, null);
      }
    } finally {
      setLookupBusy(false);
    }
  }

  async function save() {
    setError(null);
    if (!title.trim()) {
      setError("Please give it a title.");
      return;
    }
    let geometry: Geometry | null = null;
    let waypoints: Waypoint[] = [];
    if (isPoint) {
      if (!point) {
        setError("Pick a location on the map or search for a place.");
        return;
      }
      geometry = { type: "Point", coordinates: point };
    } else {
      const coords = stops.map((s) => [s.lng, s.lat] as LngLat);
      // Prefer an explicit route (real cruise track) over a derived line.
      const line = routePath && routePath.length >= 2 ? routePath : buildRoutePath(kind, coords);
      if (line.length >= 2) geometry = { type: "LineString", coordinates: line };
      waypoints = stops;
    }

    const properties: Record<string, unknown> = { ...(item?.properties ?? {}) };
    properties.pin = pinStyle; // per-item size/shape/border
    if (isPoint) delete properties.path;
    else properties.path = pathVals; // per-item trail style for routes
    if (kind === "cruise") {
      if (cruiseLine) properties.cruiseLine = cruiseLine;
      else delete properties.cruiseLine;
      if (ship) properties.ship = ship;
      else delete properties.ship;
    }

    const payload: Partial<Item> = {
      kind,
      title: title.trim(),
      notes,
      themeId,
      tripId,
      color,
      icon,
      occurredOn: occurredOn || null,
      geometry,
      waypoints,
      properties,
    };

    setBusy(true);
    try {
      const saved =
        editing && item ? await api.updateItem(item.id, payload) : await api.createItem(mapSet.id, payload);
      // Upload any staged photos against the saved item.
      for (const p of pendingPhotos) {
        await api.uploadItemPhoto(saved.id, p.file, p.caption);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  // While picking a point on the map, collapse to a thin banner.
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
            {(["place", "food", "flight", "cruise", "drive", "custom"] as ItemKind[]).map((k) => (
              <button key={k} className={k === kind ? "primary" : ""} onClick={() => applyKind(k)}>
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Anniversary dinner" />
        </div>

        {isPoint ? (
          <PointFields
            point={point}
            onPick={pickOnMap}
            onSelect={(lng, lat, label) => { setPoint([lng, lat]); if (!title) setTitle(label); }}
            onPhotoLocation={(lat, lng, date) => { setPoint([lng, lat]); if (date && !occurredOn) setOccurredOn(date); }}
          />
        ) : kind === "flight" ? (
          <FlightFields setResult={applyLookup} />
        ) : kind === "cruise" ? (
          <>
            <CruiseFields
              cruiseLine={cruiseLine}
              ship={ship}
              sailDate={occurredOn ?? ""}
              busy={lookupBusy}
              result={cruiseResult}
              reuse={reuseItinerary}
              lineConfirmed={lineConfirmed}
              shipConfirmed={shipConfirmed}
              onReuse={setReuseItinerary}
              onLineText={(t) => { setCruiseLine(t); setLineConfirmed(false); setShipConfirmed(false); setShipUrl(null); }}
              onLinePick={(name) => { setCruiseLine(name); setLineConfirmed(true); }}
              onShipText={(t) => { setShip(t); setShipUrl(null); setShipConfirmed(false); }}
              onShipPick={(name, url) => { setShip(name); setShipUrl(url); setShipConfirmed(true); }}
              onSailDate={setOccurredOn}
              onFind={findCruise}
              onPickSailing={pickSailing}
              onAddPort={addPortChip}
            />
            <StopBuilder stops={stops} onChange={changeStops} source="ports" label="Ports of call (in order)" />
          </>
        ) : (
          <StopBuilder stops={stops} onChange={changeStops} source="places" label="Stops along the drive (in order)" />
        )}

        {warnings.length > 0 && (
          <div className="warnings">
            {warnings.map((w, i) => (
              <div key={i}>• {w}</div>
            ))}
          </div>
        )}

        {lookupImage && (
          <div className="field">
            <img src={lookupImage} alt="" style={{ width: "100%", borderRadius: "var(--radius)", maxHeight: 160, objectFit: "cover" }} />
            <div className="row" style={{ marginTop: 6, alignItems: "center", gap: 8 }}>
              {cruiseResult?.lineLogo && (
                <img
                  src={cruiseResult.lineLogo}
                  alt={cruiseResult.lineName ?? "line logo"}
                  style={{ height: 30, width: "auto", background: "#fff", borderRadius: 4, padding: 2 }}
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              )}
              {cruiseResult?.lineLogo && (
                <button type="button" onClick={() => useImageAsPin(cruiseResult.lineLogo!)} disabled={pinBusy}>
                  {pinBusy ? "Importing…" : "🏷 Use line logo as pin"}
                </button>
              )}
              <button type="button" onClick={() => useImageAsPin(lookupImage)} disabled={pinBusy}>
                📌 Use ship photo as pin
              </button>
            </div>
          </div>
        )}

        {kind === "flight" && stops.length > 0 && (
          <div className="field">
            <label>Stops ({stops.length})</label>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{stops.map((s) => s.label).join("  →  ")}</div>
          </div>
        )}

        {kind !== "cruise" && (
          <div className="field">
            <label>Date (optional)</label>
            <input type="date" value={occurredOn ?? ""} onChange={(e) => setOccurredOn(e.target.value)} />
          </div>
        )}

        <div className="field">
          <label>Theme</label>
          <select value={themeId ?? ""} onChange={(e) => applyTheme(e.target.value || null)}>
            <option value="">— None (custom style) —</option>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} {t.isBuiltin ? "" : "(yours)"}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Trip</label>
          <select value={tripId ?? ""} onChange={(e) => setTripId(e.target.value || null)}>
            <option value="">— No trip —</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <StylePicker color={color} icon={icon} customIcons={customIcons} onColor={setColor} onIcon={setIcon} onUploaded={onIconsChanged} />
        <PinStyleControls value={pinStyle} color={color} icon={icon} onChange={setPinStyle} />
        {!isPoint && (
          <>
            <div className="section-title"><span>Trail (path line)</span></div>
            <PathStyleControls value={pathVals} customIcons={customIcons} onChange={setPathVals} />
          </>
        )}

        <div className="field">
          <label>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="field">
          <label>Photos</label>
          <div className="photo-grid">
            {existingPhotos.map((p) => (
              <div key={p.id} className="photo-tile">
                <MediaThumb photo={p} />
                <button type="button" className="photo-remove" onClick={() => deleteExisting(p.id)}>✕</button>
                <input
                  className="photo-caption"
                  defaultValue={p.caption}
                  placeholder="Caption…"
                  onBlur={(e) => e.target.value !== p.caption && saveCaption(p.id, e.target.value)}
                />
              </div>
            ))}
            {pendingPhotos.map((p, i) => (
              <div key={i} className="photo-tile">
                {p.file.type.startsWith("image") ? (
                  <img src={p.preview} alt="" />
                ) : (
                  <div className="media-placeholder">{p.file.type.startsWith("video") ? "▶" : "🎵"}</div>
                )}
                <button type="button" className="photo-remove" onClick={() => removePending(i)}>✕</button>
                <input
                  className="photo-caption"
                  value={p.caption}
                  placeholder="Caption…"
                  onChange={(e) =>
                    setPendingPhotos((prev) => prev.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))
                  }
                />
              </div>
            ))}
          </div>
          <input
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            style={{ marginTop: 8 }}
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          {pendingPhotos.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              {pendingPhotos.length} photo(s) will upload when you save.
            </div>
          )}
        </div>

        {error && <div className="error-text">{error}</div>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PointFields({
  point,
  onPick,
  onSelect,
  onPhotoLocation,
}: {
  point: [number, number] | null;
  onPick: () => void;
  onSelect: (lng: number, lat: number, label: string) => void;
  onPhotoLocation: (lat: number, lng: number, date: string | null) => void;
}) {
  const [exifMsg, setExifMsg] = useState<string | null>(null);

  async function fromPhoto(file: File) {
    setExifMsg("Reading photo…");
    try {
      const { lat, lng, date } = await api.readExif(file);
      if (lat != null && lng != null) {
        onPhotoLocation(lat, lng, date);
        setExifMsg("Placed from photo GPS ✓");
      } else {
        setExifMsg("No GPS found in that photo.");
      }
    } catch {
      setExifMsg("Could not read that photo.");
    }
  }

  return (
    <div className="field">
      <label>Location</label>
      <PlaceSearch placeholder="Search a place or address…" search={api.searchPlaces} onSelect={(s) => onSelect(s.lng, s.lat, s.label)} />
      <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
        <button type="button" onClick={onPick}>📍 Pick on map</button>
        <label className="filebtn" style={{ margin: 0 }}>
          📷 From photo
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && fromPhoto(e.target.files[0])} />
        </label>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
        {exifMsg ?? (point ? `${point[1].toFixed(4)}, ${point[0].toFixed(4)}` : "No location set")}
      </div>
    </div>
  );
}

function FlightFields({ setResult }: { setResult: (r: LookupResult) => void }) {
  const [mode, setMode] = useState<"codes" | "number">("codes");
  const [codes, setCodes] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      if (mode === "codes") {
        const list = codes.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean);
        setResult(await api.lookupFlight({ codes: list }));
      } else {
        setResult(await api.lookupFlight({ flightNumber, date }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label>Flight route</label>
      <div className="tabs">
        <button type="button" className={mode === "codes" ? "active" : ""} onClick={() => setMode("codes")}>Airports</button>
        <button type="button" className={mode === "number" ? "active" : ""} onClick={() => setMode("number")}>Flight #</button>
      </div>
      {mode === "codes" ? (
        <input value={codes} onChange={(e) => setCodes(e.target.value.toUpperCase())} placeholder="JFK, CDG, FCO  (in order)" />
      ) : (
        <div className="row">
          <input value={flightNumber} onChange={(e) => setFlightNumber(e.target.value.toUpperCase())} placeholder="BA178" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}
      <button type="button" style={{ marginTop: 8 }} onClick={run} disabled={busy}>
        {busy ? "Looking up…" : "Plot route"}
      </button>
    </div>
  );
}

function CruiseFields({
  cruiseLine,
  ship,
  sailDate,
  busy,
  result,
  reuse,
  lineConfirmed,
  shipConfirmed,
  onReuse,
  onLineText,
  onLinePick,
  onShipText,
  onShipPick,
  onSailDate,
  onFind,
  onPickSailing,
  onAddPort,
}: {
  cruiseLine: string;
  ship: string;
  sailDate: string;
  busy: boolean;
  result: CruiseFindResult | null;
  reuse: boolean;
  lineConfirmed: boolean;
  shipConfirmed: boolean;
  onReuse: (b: boolean) => void;
  onLineText: (s: string) => void;
  onLinePick: (name: string) => void;
  onShipText: (s: string) => void;
  onShipPick: (name: string, url: string) => void;
  onSailDate: (s: string) => void;
  onFind: () => void;
  onPickSailing: (s: CruiseSailing) => void;
  onAddPort: (label: string, lng: number | null, lat: number | null) => void;
}) {
  return (
    <div className="field">
      <label>Find an itinerary (CruiseMapper)</label>
      <div className="row">
        <Autocomplete
          value={cruiseLine}
          placeholder="Cruise line — start typing (e.g. Royal)"
          confirmed={lineConfirmed}
          search={api.searchCruiseLines}
          onText={onLineText}
          onPick={(item) => onLinePick(item.name)}
        />
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <Autocomplete
          value={ship}
          placeholder={cruiseLine ? "Ship — start typing (e.g. Symphony)" : "Cruise line first, then ship"}
          confirmed={shipConfirmed}
          search={(q) => (cruiseLine.trim() ? api.searchCruiseShips(q, cruiseLine) : Promise.resolve([]))}
          onText={onShipText}
          onPick={(item) => onShipPick(item.name, item.url)}
        />
        <input type="date" value={sailDate} onChange={(e) => onSailDate(e.target.value)} title="Sail date" style={{ maxWidth: 150 }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        Tip: pick from the suggestions when they appear. If none show, type the names and we'll match them.
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 13, color: "var(--text)" }}>
        <input type="checkbox" style={{ width: "auto" }} checked={reuse} onChange={(e) => onReuse(e.target.checked)} />
        Reuse this itinerary for my dates (keep my start date; shift port days to match)
      </label>
      {reuse && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          Pick the sailing whose route matches yours — its dates will be shifted onto your start date.
        </div>
      )}
      <button type="button" style={{ marginTop: 8 }} onClick={onFind} disabled={busy || !ship.trim()}>
        {busy ? "Searching CruiseMapper…" : "🔎 Find on CruiseMapper"}
      </button>

      {result && result.shipName && (
        <div style={{ marginTop: 6, fontSize: 13 }}>Found: <strong>{result.shipName}</strong></div>
      )}

      {result && result.sailings.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="sub" style={{ marginBottom: 4 }}>Sailings — pick the one matching your date:</div>
          <div className="sailing-list">
            {result.sailings.map((s, i) => (
              <div
                key={i}
                className={`sailing-row ${sailDate && s.dateISO === sailDate ? "match" : ""}`}
                onClick={() => onPickSailing(s)}
              >
                <span className="sailing-date">{s.dateText}</span>
                <span className="sailing-title">{s.title}</span>
                <span className="sailing-dep">{s.departurePort}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && result.ports.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="sub" style={{ marginBottom: 4 }}>Ports this ship visits — tap to add in order:</div>
          <div className="chips">
            {result.ports.map((p, i) => (
              <button key={i} type="button" className="chip" onClick={() => onAddPort(p.label, p.lng, p.lat)}>
                + {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
        Auto-lookup is best-effort. You can always add or reorder ports below.
      </div>
    </div>
  );
}
