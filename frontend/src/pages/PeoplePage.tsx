import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Person } from "../api/client";
import { EntityList } from "../components/shared/EntityList";
import { EntityDetail } from "../components/shared/EntityDetail";
import { EntityThumb } from "../components/shared/EntityThumb";
import { RelatedPanel } from "../components/shared/RelatedPanel";
import { PersonForm } from "../components/people/PersonForm";
import { EmptyState, ErrorState, Spinner } from "../components/ui";

export function PeoplePage() {
  const qc = useQueryClient();
  const { data: people, isLoading, isError, refetch } = useQuery({ queryKey: ["people"], queryFn: api.listPeople });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const [adding, setAdding] = useState(false);

  const selected = people?.find((p) => p.id === selectedId) ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["people"] });

  async function remove(p: Person) {
    await api.deletePerson(p.id);
    setSelectedId(null);
    refresh();
  }

  return (
    <div className="page">
      <header className="app-header">
        <span className="brand">👤 People</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setAdding(true)}>+ Add person</button>
      </header>

      <div className="page-body">
        {isError ? (
          <ErrorState hint="Couldn't load people." onRetry={() => refetch()} />
        ) : isLoading ? (
          <Spinner label="Loading people…" />
        ) : people && people.length > 0 ? (
          <EntityList
            items={people}
            getKey={(p) => p.id}
            getSearchText={(p) => `${p.displayName} ${p.relationship}`}
            searchPlaceholder="Search people…"
            onSelect={(p) => setSelectedId(p.id)}
            renderRow={(p) => (
              <>
                <EntityThumb thumbUrl={p.avatarUrl} label={p.displayName} />
                <span className="er-main">
                  <span className="er-title">{p.displayName}</span>
                  {p.relationship && <span className="er-sub"> · {p.relationship}</span>}
                </span>
              </>
            )}
          />
        ) : (
          <EmptyState
            emoji="👋"
            title="No people yet"
            hint="Add your first family member or travel companion."
            action={<button className="primary" onClick={() => setAdding(true)}>Add a person</button>}
          />
        )}
      </div>

      {selected && !editing && (
        <EntityDetail
          title={selected.displayName}
          subtitle={selected.relationship || null}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditing(selected)}
          onDelete={() => remove(selected)}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
            <EntityThumb thumbUrl={selected.avatarUrl} label={selected.displayName} size={64} />
            {selected.userId && <span className="er-sub">Linked to a login account</span>}
          </div>
          {selected.notes && <p>{selected.notes}</p>}
          <RelatedPanel entity={`person:${selected.id}`} addTypes={["visit", "trip", "media"]} />
        </EntityDetail>
      )}

      {(adding || editing) && (
        <PersonForm
          person={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={(p) => { setAdding(false); setEditing(null); setSelectedId(p.id); refresh(); }}
        />
      )}
    </div>
  );
}
