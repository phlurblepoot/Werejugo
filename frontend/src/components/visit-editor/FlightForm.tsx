import { useState } from "react";
import { api, type LookupResult } from "../../api/client";

export function FlightForm({ onResult }: { onResult: (r: LookupResult) => void }) {
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
        onResult(await api.lookupFlight({ codes: list }));
      } else {
        onResult(await api.lookupFlight({ flightNumber, date }));
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
