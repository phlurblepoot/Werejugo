import { useMemo, useState } from "react";
import {
  api,
  type CustomIcon,
  type Geometry,
  type Item,
  type ItemKind,
  type MapSet,
  type Theme,
  type Waypoint,
} from "../api/client";
import { KIND_DEFAULTS, KIND_LABELS } from "../lib/style";
import { StylePicker } from "./StylePicker";
import { PlaceSearch } from "./PlaceSearch";

interface Props {
  mapSet: MapSet;
  item: Item | null;
  themes: Theme[];
  customIcons: CustomIcon[];
  onRequestPick: () => Promise<[number, number]>;
  onClose: () => void;
  onSaved: () => void;
}

const POINT_KINDS: ItemKind[] = ["place", "food", "custom"];

export function ItemEditor({ mapSet, item, themes, customIcons, onRequestPick, onClose, onSaved }: Props) {
  const editing = Boolean(item);
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? "place");
  const [title, setTitle] = useState(item?.title ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [occurredOn, setOccurredOn] = useState(item?.occurredOn ?? "");
  const [themeId, setThemeId] = useState<string | null>(item?.themeId ?? null);
  const [color, setColor] = useState(item?.color ?? KIND_DEFAULTS[item?.kind ?? "place"].color);
  const [icon, setIcon] = useState(item?.icon ?? KIND_DEFAULTS[item?.kind ?? "place"].icon);

  const initialPoint =
    item?.geometry?.type === "Point" ? (item.geometry.coordinates as number[]) : null;
  const [point, setPoint] = useState<[number, number] | null>(
    initialPoint ? [initialPoint[0], initialPoint[1]] : null,
  );

  const [stops, setStops] = useState<Waypoint[]>(item?.waypoints ?? []);
  const initialPath =
    item?.geometry?.type === "LineString" ? (item.geometry.coordinates as number[][]) : [];
  const [path, setPath] = useState<number[][]>(initialPath);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const isPoint = POINT_KINDS.includes(kind);

  function applyKind(k: ItemKind) {
    setKind(k);
    if (!themeId) {
      setColor(KIND_DEFAULTS[k].color);
      setIcon(KIND_DEFAULTS[k].icon);
    }
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
      const coords = path.length >= 2 ? path : stops.map((s) => [s.lng, s.lat]);
      if (coords.length >= 2) geometry = { type: "LineString", coordinates: coords };
      waypoints = stops;
    }

    const payload: Partial<Item> = {
      kind,
      title: title.trim(),
      notes,
      themeId,
      color,
      icon,
      occurredOn: occurredOn || null,
      geometry,
      waypoints,
    };

    setBusy(true);
    try {
      if (editing && item) await api.updateItem(item.id, payload);
      else await api.createItem(mapSet.id, payload);
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
          <PointFields point={point} onPick={pickOnMap} onSelect={(lng, lat, label) => { setPoint([lng, lat]); if (!title) setTitle(label); }} />
        ) : kind === "flight" ? (
          <FlightFields setResult={(r) => applyLookup(r, setTitle, setStops, setPath, setWarnings, title)} />
        ) : kind === "cruise" ? (
          <CruiseFields setResult={(r) => applyLookup(r, setTitle, setStops, setPath, setWarnings, title)} />
        ) : (
          <DriveFields stops={stops} setStops={(s) => { setStops(s); setPath(s.map((x) => [x.lng, x.lat])); }} />
        )}

        {warnings.length > 0 && (
          <div className="warnings">
            {warnings.map((w, i) => (
              <div key={i}>• {w}</div>
            ))}
          </div>
        )}

        {!isPoint && stops.length > 0 && (
          <div className="field">
            <label>Stops ({stops.length})</label>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {stops.map((s) => s.label).join("  →  ")}
            </div>
          </div>
        )}

        <div className="field">
          <label>Date (optional)</label>
          <input type="date" value={occurredOn ?? ""} onChange={(e) => setOccurredOn(e.target.value)} />
        </div>

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

        <StylePicker color={color} icon={icon} customIcons={customIcons} onColor={setColor} onIcon={setIcon} />

        <div className="field">
          <label>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
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

function applyLookup(
  r: { title: string; waypoints: Array<{ label: string; lng: number; lat: number; kind: string }>; path: number[][]; warnings: string[] },
  setTitle: (s: string) => void,
  setStops: (w: Waypoint[]) => void,
  setPath: (p: number[][]) => void,
  setWarnings: (w: string[]) => void,
  currentTitle: string,
) {
  if (r.title && !currentTitle) setTitle(r.title);
  setStops(
    r.waypoints.map((w, i) => ({
      label: w.label,
      kind: (w.kind as Waypoint["kind"]) ?? "stop",
      lng: w.lng,
      lat: w.lat,
      seq: i,
    })),
  );
  setPath(r.path);
  setWarnings(r.warnings);
}

function PointFields({
  point,
  onPick,
  onSelect,
}: {
  point: [number, number] | null;
  onPick: () => void;
  onSelect: (lng: number, lat: number, label: string) => void;
}) {
  return (
    <div className="field">
      <label>Location</label>
      <PlaceSearch placeholder="Search a place or address…" search={api.searchPlaces} onSelect={(s) => onSelect(s.lng, s.lat, s.label)} />
      <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
        <button type="button" onClick={onPick}>📍 Pick on map</button>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {point ? `${point[1].toFixed(4)}, ${point[0].toFixed(4)}` : "No location set"}
        </div>
      </div>
    </div>
  );
}

type LookupSetter = (r: { title: string; waypoints: Array<{ label: string; lng: number; lat: number; kind: string }>; path: number[][]; warnings: string[] }) => void;

function FlightFields({ setResult }: { setResult: LookupSetter }) {
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

function CruiseFields({ setResult }: { setResult: LookupSetter }) {
  const [mode, setMode] = useState<"ports" | "ship">("ports");
  const [ports, setPorts] = useState("");
  const [ship, setShip] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      if (mode === "ports") {
        const list = ports.split(/\n+/).map((p) => p.trim()).filter(Boolean);
        setResult(await api.lookupCruise({ ports: list }));
      } else {
        setResult(await api.lookupCruise({ ship }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label>Cruise itinerary</label>
      <div className="tabs">
        <button type="button" className={mode === "ports" ? "active" : ""} onClick={() => setMode("ports")}>Ports</button>
        <button type="button" className={mode === "ship" ? "active" : ""} onClick={() => setMode("ship")}>By ship</button>
      </div>
      {mode === "ports" ? (
        <textarea value={ports} onChange={(e) => setPorts(e.target.value)} placeholder={"One port per line, in order:\nMiami\nNassau\nCozumel"} />
      ) : (
        <input value={ship} onChange={(e) => setShip(e.target.value)} placeholder="Ship name (e.g. Symphony of the Seas)" />
      )}
      <button type="button" style={{ marginTop: 8 }} onClick={run} disabled={busy}>
        {busy ? "Looking up…" : "Plot itinerary"}
      </button>
    </div>
  );
}

function DriveFields({ stops, setStops }: { stops: Waypoint[]; setStops: (w: Waypoint[]) => void }) {
  const seq = useMemo(() => stops.length, [stops]);
  return (
    <div className="field">
      <label>Stops along the drive (in order)</label>
      <PlaceSearch
        placeholder="Add a stop…"
        search={api.searchPlaces}
        onSelect={(s) =>
          setStops([...stops, { label: s.label, kind: stops.length === 0 ? "origin" : "stop", lng: s.lng, lat: s.lat, seq }])
        }
      />
      {stops.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {stops.map((s, i) => (
            <div key={i} className="row" style={{ alignItems: "center", marginBottom: 4 }}>
              <span style={{ flex: 1, fontSize: 13 }}>{i + 1}. {s.label}</span>
              <button type="button" className="ghost" onClick={() => setStops(stops.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
