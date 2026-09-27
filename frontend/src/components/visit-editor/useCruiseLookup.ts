import { useState } from "react";
import { api, type CruiseFindResult, type CruiseSailing, type ItineraryMatch } from "../../api/client";
import { lineMetres } from "../../lib/routing";
import type { VisitDraft } from "./useVisitDraft";

/** Something went wrong asking CruiseMapper: what to say, and whether trying again could help. */
export interface CruiseProblem { message: string; retry?: () => void }

const DAY_MS = 24 * 3600 * 1000;

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
  const [problem, setProblem] = useState<CruiseProblem | null>(null);
  const [matches, setMatches] = useState<ItineraryMatch[] | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  /** Turned off (409) says so; not answering (503) offers Try again. */
  function trouble(e: unknown, retry: () => void) {
    const status = (e as { status?: number }).status;
    const message = e instanceof Error && e.message ? e.message : "Couldn't reach CruiseMapper.";
    setProblem(status === 409 ? { message } : { message, retry: () => { setProblem(null); retry(); } });
  }

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
    setProblem(null);
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
        if (closest) await pickSailing(closest, res);
      }
    } catch (e) {
      trouble(e, () => void find());
    } finally {
      setBusy(false);
    }
  }

  async function pickSailing(s: CruiseSailing, found: CruiseFindResult | null = result) {
    if (!draft.title.trim()) set({ title: `${found?.shipName || draft.ship} — ${s.title}`.trim() });
    if (!reuse && s.dateISO) set({ occurredOn: s.dateISO });
    const offsetMs = reuse && draft.occurredOn && s.dateISO ? Date.parse(draft.occurredOn) - Date.parse(s.dateISO) : 0;
    if (!s.id) { if (s.departurePort) addPort(s.departurePort, null, null); return; }
    setBusy(true);
    setProblem(null);
    try {
      const d = await api.getSailingDetail(s.id, s.dateISO);
      if (d.ports.length) {
        const path = d.path && d.path.length >= 2 ? d.path : null;
        set({
          // Kept with the cruise, so it's never looked up again.
          cruise: {
            line: found?.lineName ?? (draft.cruiseLine || null), ship: found?.shipName || draft.ship || null,
            shipUrl: found?.shipUrl ?? shipUrl, shipImage: found?.image ?? null, lineLogo: found?.lineLogo ?? null,
            sailingId: s.id, sailingTitle: s.title || null, sailingDate: s.dateISO,
            matchedBy: "date", shiftDays: Math.round(offsetMs / DAY_MS),
          },
          route: path ? { source: "cruisemapper", distanceM: lineMetres(path) } : null,
          stops: d.ports.map((p, i) => {
            const baseDepart = p.departAt ?? (p.dateISO ? `${p.dateISO}T00:00:00.000Z` : null);
            return {
              label: p.label, kind: p.kind, lng: p.lng, lat: p.lat, seq: i,
              arriveAt: shiftIso(p.arriveAt ?? null, offsetMs),
              departAt: shiftIso(baseDepart, offsetMs),
            };
          }),
          routePath: path,
        });
        if (d.warnings.length) setWarnings(d.warnings);
      } else {
        setWarnings(d.warnings.length ? d.warnings : ["Couldn't read that sailing's ports. Add them below."]);
        if (s.departurePort) addPort(s.departurePort, null, null);
      }
    } catch (e) {
      trouble(e, () => void pickSailing(s, found));
    } finally {
      setBusy(false);
    }
  }

  /** A past cruise: sailings with the same itinerary (from its ports, or its length and first port). */
  async function findSameItinerary() {
    setBusy(true);
    setProblem(null);
    try {
      const ports = draft.stops.length >= 2 ? draft.stops.map((s) => ({ name: s.label, lng: s.lng, lat: s.lat })) : undefined;
      const nights = draft.occurredOn && draft.occurredEnd
        ? Math.round((Date.parse(draft.occurredEnd) - Date.parse(draft.occurredOn)) / DAY_MS) || undefined
        : undefined;
      const r = await api.matchCruise({
        ship: draft.ship.trim() || undefined, shipUrl: shipUrl ?? result?.shipUrl ?? undefined, line: draft.cruiseLine.trim() || undefined,
        ports, departurePort: ports ? undefined : draft.stops[0]?.label, nights, date: draft.occurredOn,
      });
      setMatches(r.matches);
      setWarnings(r.warnings);
    } catch (e) {
      trouble(e, () => void findSameItinerary());
    } finally {
      setBusy(false);
    }
  }

  /** Use a matched sailing's ports and track, moved to this cruise's dates. */
  function applyMatch(m: ItineraryMatch) {
    const offsetMs = m.shiftDays * DAY_MS;
    const path = m.path.length >= 2 ? m.path : null;
    const lastDay = m.ports[m.ports.length - 1]?.dateISO;
    set({
      stops: m.ports.map((p, i) => ({
        label: p.label, kind: p.kind, lng: p.lng, lat: p.lat, seq: i,
        arriveAt: shiftIso(p.arriveAt ?? null, offsetMs),
        departAt: shiftIso(p.departAt ?? (p.dateISO && !p.arriveAt ? `${p.dateISO}T00:00:00.000Z` : null), offsetMs),
      })),
      routePath: path,
      route: path ? { source: "cruisemapper", distanceM: lineMetres(path) } : null,
      cruise: {
        line: draft.cruiseLine || null, ship: draft.ship || null, shipUrl: shipUrl ?? result?.shipUrl ?? null,
        shipImage: result?.image ?? null, lineLogo: result?.lineLogo ?? null,
        sailingId: m.sailing.id, sailingTitle: m.sailing.title || null, sailingDate: m.sailing.dateISO,
        matchedBy: "itinerary", shiftDays: m.shiftDays,
      },
      ...(draft.title.trim() ? {} : { title: `${draft.ship || m.sailing.ship} — ${m.sailing.title}`.trim() }),
      ...(!draft.occurredEnd && lastDay ? { occurredEnd: new Date(Date.parse(lastDay) + offsetMs).toISOString().slice(0, 10) } : {}),
    });
    setMatches(null);
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
    busy, result, lineConfirmed, shipConfirmed, reuse, lookupImage, warnings, problem, matches, pinBusy,
    findSameItinerary, applyMatch,
    setReuse, onLineText, onLinePick, onShipText, onShipPick, find, pickSailing, addPort, useImageAsPin,
  };
}
