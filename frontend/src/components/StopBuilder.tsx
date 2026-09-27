import { useCallback } from "react";
import { api, type PlaceSuggestion, type Waypoint } from "../api/client";
import { mapCentre } from "../lib/mapCentre";
import { PlaceSearch } from "./PlaceSearch";
import { formatWaypointTime } from "../lib/waypoint";

interface Props {
  stops: Waypoint[];
  onChange: (stops: Waypoint[]) => void;
  source: "ports" | "places";
  label: string;
}


function renumber(stops: Waypoint[]): Waypoint[] {
  return stops.map((s, i) => ({
    ...s,
    seq: i,
    kind: i === 0 ? "origin" : i === stops.length - 1 ? "destination" : "stop",
  }));
}

/** Add, remove and reorder an ordered list of stops (cruise ports or drive places). */
export function StopBuilder({ stops, onChange, source, label }: Props) {
  // The next stop is usually near the last one (or where the map is looking).
  const last = stops[stops.length - 1];
  const [nLng, nLat] = last ? [last.lng, last.lat] : (mapCentre() ?? [null, null]);
  const search = useCallback(
    (q: string) => (source === "ports" ? api.searchPorts(q) : api.searchPlaces(q, nLng != null && nLat != null ? [nLng, nLat] : null)),
    [source, nLng, nLat],
  );
  function add(s: PlaceSuggestion) {
    onChange(renumber([...stops, { label: s.label, kind: "stop", lng: s.lng, lat: s.lat, seq: stops.length }]));
  }
  function remove(i: number) {
    onChange(renumber(stops.filter((_, j) => j !== i)));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(renumber(next));
  }

  return (
    <div className="field">
      <label>{label}</label>
      <PlaceSearch placeholder="Add a stop…" search={search} onSelect={add} />
      {stops.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {stops.map((s, i) => (
            <div key={i} className="row" style={{ alignItems: "center", marginBottom: 4, gap: 4 }}>
              <span style={{ flex: 1, fontSize: 13 }}>
                {i + 1}. {s.label}
                {formatWaypointTime(s) ? <span style={{ color: "var(--muted)" }}> · {formatWaypointTime(s)}</span> : null}
              </span>
              <button type="button" className="ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="ghost" disabled={i === stops.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="ghost" onClick={() => remove(i)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
