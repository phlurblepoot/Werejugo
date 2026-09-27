import { useState } from "react";
import { api, type Waypoint } from "../../api/client";
import { StopBuilder } from "../StopBuilder";
import type { VisitDraft } from "./useVisitDraft";

interface Props {
  draft: VisitDraft;
  set: (patch: Partial<VisitDraft>) => void;
}

/** A flight: its airports in order, or a flight number and the day it left (every leg, its times and date). */
export function FlightForm({ draft, set }: Props) {
  const [mode, setMode] = useState<"airports" | "number">("airports");
  const [flightNumber, setFlightNumber] = useState("");
  const [date, setDate] = useState(draft.occurredOn);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function lookUp() {
    setBusy(true);
    setWarnings([]);
    try {
      const r = await api.lookupFlight({ flightNumber: flightNumber.trim(), date });
      setWarnings(r.warnings);
      if (r.waypoints.length >= 2) {
        set({
          stops: r.waypoints.map((w, i): Waypoint => ({
            label: w.label, kind: w.kind as Waypoint["kind"], lng: w.lng, lat: w.lat, seq: i,
            arriveAt: w.arriveAt ?? null, departAt: w.departAt ?? null,
          })),
          // A new line through these airports (never the one from before).
          routePath: null,
          route: null,
          occurredOn: r.date ?? date,
          ...(draft.title.trim() ? {} : { title: r.title }),
        });
      }
    } catch (e) {
      setWarnings([e instanceof Error ? e.message : "Couldn't look that flight up."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label>Flight</label>
      <div className="tabs">
        <button type="button" className={mode === "airports" ? "active" : ""} onClick={() => setMode("airports")}>Airports</button>
        <button type="button" className={mode === "number" ? "active" : ""} onClick={() => setMode("number")}>Flight number</button>
      </div>
      {mode === "number" && (
        <>
          <div className="row">
            <input aria-label="Flight number" value={flightNumber} onChange={(e) => setFlightNumber(e.target.value.toUpperCase())} placeholder="BA178" />
            <input aria-label="The day it left" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <button type="button" style={{ marginTop: 8 }} onClick={() => void lookUp()} disabled={busy || !flightNumber.trim() || !date}>
            {busy ? "Looking up…" : "Look up"}
          </button>
        </>
      )}
      {warnings.length > 0 && <div className="warnings">{warnings.map((w, i) => <div key={i}>• {w}</div>)}</div>}
      <StopBuilder
        stops={draft.stops}
        onChange={(stops) => set({ stops, routePath: null, route: null })}
        source="airports"
        label="Airports (in order)"
      />
    </div>
  );
}
