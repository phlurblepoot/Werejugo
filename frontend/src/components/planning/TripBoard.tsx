import type { Trip } from "../../api/client";

type Status = "idea" | "planning" | "booked" | "done";
const COLUMNS: { key: Status; label: string }[] = [
  { key: "idea", label: "💡 Idea" }, { key: "planning", label: "📝 Planning" },
  { key: "booked", label: "✅ Booked" }, { key: "done", label: "🏁 Done" },
];

interface Props {
  trips: Trip[];
  onOpen: (trip: Trip) => void;
  onStatusChange: (trip: Trip, status: Status) => void;
}

export function TripBoard({ trips, onOpen, onStatusChange }: Props) {
  return (
    <div className="trip-board">
      {COLUMNS.map((col) => (
        <div key={col.key} className="trip-col">
          <h5>{col.label}</h5>
          {trips.filter((t) => t.status === col.key).map((t) => (
            <div key={t.id} className="trip-card" style={{ borderLeft: `3px solid ${t.color}` }}>
              <div className="tc-title" onClick={() => onOpen(t)}>{t.name}</div>
              <div className="tc-dates">{t.startDate ? `${t.startDate}${t.endDate ? ` – ${t.endDate}` : ""}` : "no dates"}</div>
              <select aria-label={`Status for ${t.name}`} value={t.status} onChange={(e) => onStatusChange(t, e.target.value as Status)}>
                {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
              </select>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
