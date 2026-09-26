import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Trip } from "../api/client";
import { TripBoard } from "../components/planning/TripBoard";
import { TripTimeline } from "../components/planning/TripTimeline";
import { TripDetail } from "../components/planning/TripDetail";
import { TripForm } from "../components/planning/TripForm";
import { BlackoutManager } from "../components/planning/BlackoutManager";
import { EmptyState, ErrorState, Spinner } from "../components/ui";
import { Button, IconButton, PageHeader, SegmentedControl } from "../components/kit";
import { Ban, CalendarDays, ChartGantt, LayoutGrid, Plus } from "lucide-react";

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

  // /planning?trip=<id> opens that trip (e.g. after joining one).
  const [params, setParams] = useSearchParams();
  const wanted = params.get("trip");
  useEffect(() => {
    if (!wanted || !trips) return;
    const t = trips.find((x) => x.id === wanted);
    if (t) setSelected(t);
    setParams({}, { replace: true });
  }, [wanted, trips, setParams]);

  async function changeStatus(trip: Trip, status: Status) {
    await api.updateTrip(trip.id, { status });
    refresh();
  }

  return (
    <div className="page">
      <PageHeader
        icon={CalendarDays}
        title="Planning"
        views={
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[{ value: "board", label: "Board", icon: LayoutGrid }, { value: "timeline", label: "Timeline", icon: ChartGantt }]}
          />
        }
        actions={
          <>
            <IconButton label="Blackout dates" icon={Ban} variant="secondary" onClick={() => setBlackouts(true)} />
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Trip</Button>
          </>
        }
      />

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
