import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Person } from "../api/client";
import { EntityList } from "../components/shared/EntityList";
import { EntityDetail } from "../components/shared/EntityDetail";
import { EntityThumb } from "../components/shared/EntityThumb";
import { RelatedPanel } from "../components/shared/RelatedPanel";
import { PersonForm } from "../components/people/PersonForm";
import { PersonLinkRequests, PersonLinks } from "../components/people/PersonLinks";
import { EmptyState, ErrorState, Spinner } from "../components/ui";
import { Button, PageHeader, SegmentedControl } from "../components/kit";
import { ImagePlus, Plus, ScanFace, Users } from "lucide-react";
import { PhotoPicker } from "../components/photos/PhotoPicker";
import { FacesView } from "../components/people/FacesView";
import { PersonFaces } from "../components/people/PersonFaces";

export function PeoplePage() {
  const qc = useQueryClient();
  const { data: people, isLoading, isError, refetch } = useQuery({ queryKey: ["people"], queryFn: api.listPeople });
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(params.get("person"));
  // /people?person=<id> (e.g. from search) opens that person.
  useEffect(() => {
    const wanted = params.get("person");
    if (!wanted) return;
    setSelectedId(wanted);
    setParams({}, { replace: true });
  }, [params, setParams]);
  // /people?view=faces: the faces Immich found, waiting to be named.
  const view = params.get("view") === "faces" ? "faces" : "people";
  const setView = (v: "people" | "faces") => setParams(v === "faces" ? { view: "faces" } : {}, { replace: true });
  const { data: faceCount } = useQuery({ queryKey: ["faces-count"], queryFn: api.facesCount });
  const toReview = faceCount?.review ?? 0;
  const [editing, setEditing] = useState<Person | null>(null);
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);

  const selected = people?.find((p) => p.id === selectedId) ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["people"] });

  async function remove(p: Person) {
    await api.deletePerson(p.id);
    setSelectedId(null);
    refresh();
  }

  return (
    <div className="page">
      <PageHeader
        icon={Users}
        title="People"
        actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add person</Button>}
      />

      <div className="page-body">
        <SegmentedControl
          label="Show"
          className="people-views"
          value={view}
          onChange={setView}
          options={[
            { value: "people", label: "People", icon: Users },
            { value: "faces", label: toReview ? `Faces (${toReview})` : "Faces", icon: ScanFace },
          ]}
        />
        {view === "faces" ? <FacesView /> : <>
        <PersonLinkRequests />
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
        </>}
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
          <PersonFaces personId={selected.id} personName={selected.displayName} />
          <Button size="sm" icon={ImagePlus} onClick={() => setPicking(true)}>Add photos</Button>
          <RelatedPanel entity={`person:${selected.id}`} addTypes={["visit", "trip"]} />
          {picking && <PhotoPicker entity={`person:${selected.id}`} uploadLinkTo={`person:${selected.id}`} onClose={() => setPicking(false)} />}
          <PersonLinks personId={selected.id} personName={selected.displayName} />
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
