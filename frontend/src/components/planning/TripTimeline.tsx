import type { Blackout, Trip } from "../../api/client";
import { axisBounds, overlaps, placeOnAxis } from "./timeline";

interface Props { trips: Trip[]; blackouts: Blackout[]; onOpen: (trip: Trip) => void }

export function TripTimeline({ trips, blackouts, onOpen }: Props) {
  const dated = trips.filter((t) => t.startDate);
  const undated = trips.filter((t) => !t.startDate);
  const { start, end } = axisBounds([...dated.map((t) => ({ startDate: t.startDate, endDate: t.endDate })), ...blackouts]);

  return (
    <div className="trip-timeline">
      <div className="tl-axis"><span>{start}</span><span>{end}</span></div>

      {dated.map((t) => {
        const pos = placeOnAxis(start, end, t.startDate!, t.endDate ?? t.startDate!);
        const clash = blackouts.some((b) => overlaps({ startDate: t.startDate, endDate: t.endDate }, b));
        return (
          <div key={t.id} className="tl-row">
            {blackouts.map((b) => {
              const bp = placeOnAxis(start, end, b.startDate, b.endDate);
              return <div key={b.id} className="tl-black" style={{ left: `${bp.left}%`, width: `${bp.width}%` }} title={b.label} />;
            })}
            <div className="tl-bar" style={{ left: `${pos.left}%`, width: `${pos.width}%`, background: t.color }} onClick={() => onOpen(t)} title={t.name}>
              {clash ? "⚠️ " : ""}{t.name}
            </div>
          </div>
        );
      })}

      {undated.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="tl-axis"><span>Ideas (no dates)</span></div>
          {undated.map((t) => (
            <div key={t.id} className="trip-card" style={{ borderLeft: `3px solid ${t.color}` }} onClick={() => onOpen(t)}>
              <div className="tc-title">{t.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
