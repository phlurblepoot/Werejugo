import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type PackingList, type Trip } from "../api/client";
import { PackingChecklist } from "../components/packing/PackingChecklist";
import { TripPacking } from "../components/packing/TripPacking";
import { ErrorState, Spinner } from "../components/ui";

type Sel = { kind: "template"; id: string } | { kind: "trip"; trip: Trip } | null;

export function PackingPage() {
  const { data: templates = [], isLoading, isError, refetch } = useQuery({ queryKey: ["packing-templates"], queryFn: api.listPackingTemplates });
  const { data: trips = [] } = useQuery({ queryKey: ["trips"], queryFn: () => api.listTrips("") });
  const [sel, setSel] = useState<Sel>(null);

  return (
    <div className="app">
      <header className="app-header"><span className="brand">🎒 Packing</span></header>
      <div className="packing-cols">
        <div className="packing-side">
          <div className="cat-hdr">Templates</div>
          {isError ? <ErrorState hint="Couldn't load templates." onRetry={() => refetch()} /> : isLoading ? <Spinner /> : templates.map((t: PackingList) => (
            <div key={t.id} className={`entity-row${sel?.kind === "template" && sel.id === t.id ? " active" : ""}`} onClick={() => setSel({ kind: "template", id: t.id })}>
              <span className="er-main"><span className="er-title">{t.name}</span><span className="er-sub"> {t.itemCount} items{t.isBuiltin ? " · built-in" : ""}</span></span>
            </div>
          ))}
          <div className="cat-hdr" style={{ marginTop: 10 }}>Trips</div>
          {trips.map((t: Trip) => (
            <div key={t.id} className={`entity-row${sel?.kind === "trip" && sel.trip.id === t.id ? " active" : ""}`} onClick={() => setSel({ kind: "trip", trip: t })}>
              <span className="er-main"><span className="er-title">{t.name}</span></span>
            </div>
          ))}
        </div>
        <div className="packing-main">
          {sel?.kind === "template" ? <TemplateView id={sel.id} /> : sel?.kind === "trip" ? <TripPacking trip={sel.trip} /> : <div className="er-sub">Pick a template or a trip.</div>}
        </div>
      </div>
    </div>
  );
}

function TemplateView({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ["packing-list", id], queryFn: () => api.getPackingList(id) });
  if (!data) return <Spinner />;
  return <PackingChecklist listId={data.id} items={data.items} readOnly={data.isBuiltin} onChanged={() => {}} />;
}
