import { api, type CruiseSailing } from "../../api/client";
import { Autocomplete } from "../Autocomplete";
import { StopBuilder } from "../StopBuilder";
import { useCruiseLookup } from "./useCruiseLookup";
import type { VisitDraft } from "./useVisitDraft";

interface Props {
  draft: VisitDraft;
  set: (patch: Partial<VisitDraft>) => void;
}

export function CruiseForm({ draft, set }: Props) {
  const c = useCruiseLookup(draft, set);

  return (
    <>
      <div className="field">
        <label>Find an itinerary (CruiseMapper)</label>
        <div className="row">
          <Autocomplete
            value={draft.cruiseLine}
            placeholder="Cruise line — start typing (e.g. Royal)"
            confirmed={c.lineConfirmed}
            search={api.searchCruiseLines}
            onText={c.onLineText}
            onPick={(item) => c.onLinePick(item.name)}
          />
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <Autocomplete
            value={draft.ship}
            placeholder={draft.cruiseLine ? "Ship — start typing (e.g. Symphony)" : "Cruise line first, then ship"}
            confirmed={c.shipConfirmed}
            search={(q) => (draft.cruiseLine.trim() ? api.searchCruiseShips(q, draft.cruiseLine) : Promise.resolve([]))}
            onText={c.onShipText}
            onPick={(item) => c.onShipPick(item.name, item.url)}
          />
          <input type="date" value={draft.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} title="Sail date" style={{ maxWidth: 150 }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 13, color: "var(--text)" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={c.reuse} onChange={(e) => c.setReuse(e.target.checked)} />
          Reuse this itinerary for my dates (keep my start date; shift port days to match)
        </label>
        <button type="button" style={{ marginTop: 8 }} onClick={c.find} disabled={c.busy || !draft.ship.trim()}>
          {c.busy ? "Searching CruiseMapper…" : "🔎 Find on CruiseMapper"}
        </button>

        {c.result?.shipName && <div style={{ marginTop: 6, fontSize: 13 }}>Found: <strong>{c.result.shipName}</strong></div>}

        {c.result && c.result.sailings.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="sub" style={{ marginBottom: 4 }}>Sailings — pick the one matching your date:</div>
            <div className="sailing-list">
              {c.result.sailings.map((s: CruiseSailing, i: number) => (
                <div key={i} className={`sailing-row ${draft.occurredOn && s.dateISO === draft.occurredOn ? "match" : ""}`} onClick={() => c.pickSailing(s)}>
                  <span className="sailing-date">{s.dateText}</span>
                  <span className="sailing-title">{s.title}</span>
                  <span className="sailing-dep">{s.departurePort}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {c.result && c.result.ports.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="sub" style={{ marginBottom: 4 }}>Ports this ship visits — tap to add in order:</div>
            <div className="chips">
              {c.result.ports.map((p, i) => (
                <button key={i} type="button" className="chip" onClick={() => c.addPort(p.label, p.lng, p.lat)}>+ {p.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {c.warnings.length > 0 && (
        <div className="warnings">{c.warnings.map((w, i) => <div key={i}>• {w}</div>)}</div>
      )}

      {c.lookupImage && (
        <div className="field">
          <img src={c.lookupImage} alt="" style={{ width: "100%", borderRadius: "var(--radius)", maxHeight: 160, objectFit: "cover" }} />
          <div className="row" style={{ marginTop: 6, alignItems: "center", gap: 8 }}>
            {c.result?.lineLogo && (
              <button type="button" onClick={() => c.useImageAsPin(c.result!.lineLogo!)} disabled={c.pinBusy}>
                {c.pinBusy ? "Importing…" : "🏷 Use line logo as pin"}
              </button>
            )}
            <button type="button" onClick={() => c.useImageAsPin(c.lookupImage!)} disabled={c.pinBusy}>📌 Use ship photo as pin</button>
          </div>
        </div>
      )}

      <StopBuilder stops={draft.stops} onChange={(stops) => set({ stops, routePath: null })} source="ports" label="Ports of call (in order)" />
    </>
  );
}
