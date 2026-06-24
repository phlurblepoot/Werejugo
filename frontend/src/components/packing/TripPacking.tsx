import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Trip } from "../../api/client";
import { PackingChecklist } from "./PackingChecklist";

export function TripPacking({ trip }: { trip: Trip }) {
  const qc = useQueryClient();
  const key = ["trip-packing", trip.id];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.getTripPacking(trip.id) });
  const [seedMode, setSeedMode] = useState<"none" | "template" | "trip">("none");

  const refetch = () => qc.invalidateQueries({ queryKey: key });
  const start = useMutation({
    mutationFn: (opts: { fromTemplateId?: string; fromTripId?: string }) => api.createTripPacking(trip.id, opts),
    onSuccess: refetch,
  });
  const saveTpl = useMutation({ mutationFn: (v: { name: string; fromListId: string }) => api.savePackingTemplate(v) });

  const templates = useQuery({ queryKey: ["packing-templates"], queryFn: api.listPackingTemplates, enabled: seedMode === "template" });
  const trips = useQuery({ queryKey: ["trips"], queryFn: () => api.listTrips(""), enabled: seedMode === "trip" });

  if (isLoading) return <div className="er-sub">Loading…</div>;

  if (!data?.list) {
    return (
      <div>
        <div className="row" style={{ gap: 6 }}>
          <button onClick={() => start.mutate({})}>Start blank</button>
          <button onClick={() => setSeedMode("template")}>From a template</button>
          <button onClick={() => setSeedMode("trip")}>From a past trip</button>
        </div>
        {seedMode === "template" && (
          <select defaultValue="" onChange={(e) => e.target.value && start.mutate({ fromTemplateId: e.target.value })} style={{ marginTop: 6 }}>
            <option value="">— pick a template —</option>
            {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {seedMode === "trip" && (
          <select defaultValue="" onChange={(e) => e.target.value && start.mutate({ fromTripId: e.target.value })} style={{ marginTop: 6 }}>
            <option value="">— pick a trip —</option>
            {(trips.data ?? []).filter((t) => t.id !== trip.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>
    );
  }

  const list = data.list;
  return (
    <div>
      <PackingChecklist listId={list.id} items={list.items} onChanged={refetch} />
      <button style={{ marginTop: 6 }} onClick={() => {
        const name = window.prompt("Template name?", `${trip.name} packing`);
        if (name?.trim()) saveTpl.mutate({ name: name.trim(), fromListId: list.id });
      }}>💾 Save as template</button>
    </div>
  );
}
