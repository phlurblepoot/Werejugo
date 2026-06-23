import { useState } from "react";
import { api, type CruiseFindResult, type CruiseSailing } from "../../api/client";
import type { VisitDraft } from "./useVisitDraft";

/** Shift an ISO datetime by a millisecond offset (realigns reused itineraries). */
export function shiftIso(iso: string | null, offsetMs: number): string | null {
  if (!iso || offsetMs === 0) return iso;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t + offsetMs).toISOString();
}

/** The dated sailing nearest a target date (YYYY-MM-DD or ISO), or null. */
export function closestSailing(sailings: CruiseSailing[], occurredOn: string): CruiseSailing | null {
  const dated = sailings.filter((s) => s.dateISO);
  const target = occurredOn ? Date.parse(occurredOn) : NaN;
  if (!dated.length || Number.isNaN(target)) return null;
  return dated.reduce((best, s) =>
    Math.abs(Date.parse(s.dateISO!) - target) < Math.abs(Date.parse(best.dateISO!) - target) ? s : best,
  );
}

type Setter = (patch: Partial<VisitDraft>) => void;

export function useCruiseLookup(draft: VisitDraft, set: Setter) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CruiseFindResult | null>(null);
  const [shipUrl, setShipUrl] = useState<string | null>(null);
  const [lineConfirmed, setLineConfirmed] = useState<boolean>(!!draft.cruiseLine);
  const [shipConfirmed, setShipConfirmed] = useState<boolean>(!!draft.ship);
  const [reuse, setReuse] = useState(false);
  const [lookupImage, setLookupImage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pinBusy, setPinBusy] = useState(false);

  const onLineText = (t: string) => { set({ cruiseLine: t }); setLineConfirmed(false); setShipConfirmed(false); setShipUrl(null); };
  const onLinePick = (name: string) => { set({ cruiseLine: name }); setLineConfirmed(true); };
  const onShipText = (t: string) => { set({ ship: t }); setShipUrl(null); setShipConfirmed(false); };
  const onShipPick = (name: string, url: string) => { set({ ship: name }); setShipUrl(url); setShipConfirmed(true); };

  async function addPort(label: string, lng: number | null, lat: number | null) {
    if (lng != null && lat != null) { pushStop(label, lng, lat); return; }
    try {
      const p = await api.resolvePort(label);
      pushStop(p.label, p.lng, p.lat);
    } catch {
      setWarnings([`Couldn't locate "${label}" — try the search box below.`]);
    }
  }

  function pushStop(label: string, lng: number, lat: number) {
    const next = [...draft.stops, { label, kind: "stop" as const, lng, lat, seq: draft.stops.length }];
    set({
      routePath: null,
      stops: next.map((s, i) => ({
        ...s, seq: i, kind: i === 0 ? "origin" : i === next.length - 1 ? "destination" : "stop",
      })),
    });
  }

  async function find() {
    if (!draft.ship.trim()) { setWarnings(["Enter or pick a ship to search CruiseMapper."]); return; }
    setBusy(true);
    try {
      const res = await api.findCruise({
        line: draft.cruiseLine.trim() || undefined,
        ship: draft.ship.trim() || undefined,
        shipUrl: shipUrl || undefined,
      });
      setResult(res);
      setWarnings(res.warnings);
      setLookupImage(res.image ?? null);
      if (!reuse) {
        const closest = closestSailing(res.sailings, draft.occurredOn);
        if (closest) await pickSailing(closest);
      }
    } finally {
      setBusy(false);
    }
  }

  async function pickSailing(s: CruiseSailing) {
    if (!draft.title.trim()) set({ title: `${result?.shipName || draft.ship} — ${s.title}`.trim() });
    if (!reuse && s.dateISO) set({ occurredOn: s.dateISO });
    const offsetMs = reuse && draft.occurredOn && s.dateISO ? Date.parse(draft.occurredOn) - Date.parse(s.dateISO) : 0;
    if (!s.id) { if (s.departurePort) addPort(s.departurePort, null, null); return; }
    setBusy(true);
    try {
      const d = await api.getSailingDetail(s.id);
      if (d.ports.length) {
        set({
          stops: d.ports.map((p, i) => {
            const baseDepart = p.departAt ?? (p.dateISO ? `${p.dateISO}T00:00:00.000Z` : null);
            return {
              label: p.label, kind: p.kind, lng: p.lng, lat: p.lat, seq: i,
              arriveAt: shiftIso(p.arriveAt ?? null, offsetMs),
              departAt: shiftIso(baseDepart, offsetMs),
            };
          }),
          routePath: d.path && d.path.length >= 2 ? d.path : null,
        });
        if (d.warnings.length) setWarnings(d.warnings);
      } else {
        setWarnings(d.warnings.length ? d.warnings : ["Couldn't read that sailing's ports — add them manually below."]);
        if (s.departurePort) addPort(s.departurePort, null, null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function useImageAsPin(url: string) {
    setPinBusy(true);
    try {
      const r = await api.uploadFromUrl(url);
      set({ icon: r.thumbUrl || r.url });
    } catch {
      setWarnings(["Couldn't import that image as a pin."]);
    } finally {
      setPinBusy(false);
    }
  }

  return {
    busy, result, lineConfirmed, shipConfirmed, reuse, lookupImage, warnings, pinBusy,
    setReuse, onLineText, onLinePick, onShipText, onShipPick, find, pickSailing, addPort, useImageAsPin,
  };
}
