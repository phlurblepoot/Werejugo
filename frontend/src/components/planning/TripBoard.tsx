import type { Trip } from "../../api/client";
import { formatDateRange } from "../../lib/dates";
import { ByFamily } from "../shared/ByFamily";

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
              <div className="tc-dates">{t.startDate ? formatDateRange(t.startDate, t.endDate) : "no dates"}</div>
              {t.role && t.role !== "host" && <ByFamily prefix="Shared by " name={t.hostFamilyName} title={`Hosted by ${t.hostFamilyName}`} />}
              {(!t.role || t.role === "host") && (t.guestFamilies ?? 0) > 0 && (
                <ByFamily name={`Shared with ${t.guestFamilies} ${t.guestFamilies === 1 ? "family" : "families"}`} title="Other families are on this trip" />
              )}
              {/* Only the host family moves a trip between columns. */}
              <select aria-label={`Status for ${t.name}`} value={t.status} disabled={!!t.role && t.role !== "host"}
                onChange={(e) => onStatusChange(t, e.target.value as Status)}>
                {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
              </select>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
