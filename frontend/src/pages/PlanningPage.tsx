import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Trip } from "../api/client";
import { TripBoard } from "../components/planning/TripBoard";
import { TripTimeline } from "../components/planning/TripTimeline";
import { TripDetail } from "../components/planning/TripDetail";
import { TripForm } from "../components/planning/TripForm";
import { BlackoutManager } from "../components/planning/BlackoutManager";
import { EmptyState, ErrorState, Spinner } from "../components/ui";

type Status = "idea" | "planning" | "booked" | "done";

export function PlanningPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"board" | "timeline">("board");
  const [selected, setSelected] = useState<Trip | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [blackouts, setBlackouts] = useState(false);

  const { data: trips, isLoading, isError, refetch } = useQuery({ queryKey: ["trips"], queryFn: () => api.listTrips("") });
  const { data: blackoutList = [] } = useQuery({ queryKey: ["blackouts"], queryFn: api.listBlackouts });
  const refresh = () => qc.invalidateQueries({ queryKey: ["trips"] });

  async function changeStatus(trip: Trip, status: Status) {
    await api.updateTrip(trip.id, { status });
    refresh();
  }

  return (
    <div className="page">
      <header className="app-header">
        <span className="brand">📅 Planning</span>
        <span className="spacer" />
        <div className="tabs">
          <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>▦ Board</button>
          <button className={view === "timeline" ? "active" : ""} onClick={() => setView("timeline")}>📈 Timeline</button>
        </div>
        <button onClick={() => setBlackouts(true)}>⛔ Blackouts</button>
        <button className="primary" onClick={() => setAdding(true)}>+ Trip</button>
      </header>

      <div className="page-body">
        {isError ? (
          <ErrorState hint="Couldn't load trips." onRetry={() => refetch()} />
        ) : isLoading ? (
          <Spinner label="Loading trips…" />
        ) : (trips && trips.length > 0) ? (
          view === "board" ? (
            <TripBoard trips={trips} onOpen={setSelected} onStatusChange={changeStatus} />
          ) : (
            <TripTimeline trips={trips} blackouts={blackoutList} onOpen={setSelected} />
          )
        ) : (
          <EmptyState emoji="📅" title="No trips yet" hint="Plan a future trip — an idea, a date, an itinerary."
            action={<button className="primary" onClick={() => setAdding(true)}>Plan a trip</button>} />
        )}
      </div>

      {selected && <TripDetail trip={selected} onClose={() => setSelected(null)} onChanged={() => { refresh(); }} />}
      {(adding || editing) && (
        <TripForm trip={editing} onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); refresh(); }} />
      )}
      {blackouts && <BlackoutManager onClose={() => setBlackouts(false)} />}
    </div>
  );
}
