import { useEffect, useState } from "react";
import { computeRoute } from "../../lib/routing";
import type { VisitDraft } from "./useVisitDraft";

const WAIT_MS = 500; // after the last change to the stops

/**
 * Keeps a drive's or cruise's line following its stops: whenever the stops
 * change (which clears `routePath`), the line along roads or water is fetched
 * again. A cruise's line from CruiseMapper is kept until its ports change.
 */
export function useAutoRoute(draft: VisitDraft, set: (patch: Partial<VisitDraft>) => void) {
  const [routing, setRouting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const routed = draft.kind === "drive" || draft.kind === "cruise";
  const coords = draft.stops.map((s) => [s.lng, s.lat] as [number, number]);
  const key = `${draft.kind}|${JSON.stringify(coords)}`;
  const needed = routed && !draft.routePath && coords.length >= 2;

  useEffect(() => {
    if (!needed) { setRouting(false); return; }
    let cancelled = false;
    setRouting(true);
    const timer = setTimeout(async () => {
      const r = await computeRoute(draft.kind, coords);
      if (cancelled) return;
      set({ routePath: r.path, route: r.route });
      setNote(r.note ?? null);
      setRouting(false);
    }, WAIT_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // `coords` is in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, needed]);

  return { routing, note };
}
