import { useCallback } from "react";
import { api, type PlaceSuggestion, type Waypoint } from "../api/client";
import { mapCentre } from "../lib/mapCentre";
import { PlaceSearch } from "./PlaceSearch";
import { formatWaypointTime } from "../lib/waypoint";

interface Props {
  stops: Waypoint[];
  onChange: (stops: Waypoint[]) => void;
  source: "ports" | "places" | "airports";
  label: string;
  /** A day for each stop (a cruise's port days): the first is `startDate`, each added one the day after the last. */
  dated?: boolean;
  startDate?: string;
  inputId?: string;
}

const DAY_MS = 24 * 3600 * 1000;
/** The day a stop is on: its arrival, or (the first stop) its departure. */
export const dayOf = (s: Waypoint) => (s.arriveAt ?? s.departAt ?? null)?.slice(0, 10) ?? "";
/** An ISO time moved to another day, keeping its time of day. */
const onDay = (iso: string | null | undefined, day: string) => (iso ? `${day}${iso.slice(10)}` : `${day}T00:00:00.000Z`);


function renumber(stops: Waypoint[]): Waypoint[] {
  return stops.map((s, i) => ({
    ...s,
    seq: i,
    kind: i === 0 ? "origin" : i === stops.length - 1 ? "destination" : "stop",
  }));
}

/** Add, remove and reorder an ordered list of stops (cruise ports or drive places). */
export function StopBuilder({ stops, onChange, source, label, dated, startDate, inputId }: Props) {
  // The next stop is usually near the last one (or where the map is looking).
  const last = stops[stops.length - 1];
  const [nLng, nLat] = last ? [last.lng, last.lat] : (mapCentre() ?? [null, null]);
  const search = useCallback(
    (q: string) => (source === "ports" ? api.searchPorts(q)
      : source === "airports" ? api.searchAirports(q)
      : api.searchPlaces(q, nLng != null && nLat != null ? [nLng, nLat] : null)),
    [source, nLng, nLat],
  );
  function add(s: PlaceSuggestion) {
    const stop: Waypoint = { label: s.label, kind: "stop", lng: s.lng, lat: s.lat, seq: stops.length };
    if (dated) {
      // The day after the last port's, or (ports without days) the start date plus this one's place.
      const lastDay = stops.length ? dayOf(stops[stops.length - 1]) : "";
      const from = lastDay || startDate || "";
      const day = from ? new Date(Date.parse(from) + (lastDay ? 1 : stops.length) * DAY_MS).toISOString().slice(0, 10) : "";
      if (day) {
        if (stops.length) stop.arriveAt = `${day}T00:00:00.000Z`;
        else stop.departAt = `${day}T00:00:00.000Z`;
      }
    }
    onChange(renumber([...stops, stop]));
  }
  function setDay(i: number, day: string) {
    onChange(stops.map((s, j) => {
      if (j !== i) return s;
      if (!day) return { ...s, arriveAt: null, departAt: null };
      return i === 0 && !s.arriveAt
        ? { ...s, departAt: onDay(s.departAt, day) }
        : { ...s, arriveAt: onDay(s.arriveAt, day), ...(s.departAt ? { departAt: onDay(s.departAt, day) } : {}) };
    }));
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
      <PlaceSearch placeholder="Add a stop…" inputId={inputId} search={search} onSelect={add} />
      {stops.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {stops.map((s, i) => (
            <div key={i} className="row" style={{ alignItems: "center", marginBottom: 4, gap: 4 }}>
              <span style={{ flex: 1, fontSize: 13 }}>
                {i + 1}. {s.label}
                {!dated && formatWaypointTime(s) ? <span style={{ color: "var(--muted)" }}> · {formatWaypointTime(s)}</span> : null}
              </span>
              {dated && (
                <input type="date" aria-label={`Day at ${s.label}`} value={dayOf(s)} style={{ maxWidth: 150 }} onChange={(e) => setDay(i, e.target.value)} />
              )}
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
