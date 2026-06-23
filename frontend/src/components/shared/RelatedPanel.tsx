import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type CoreType, type EntitySummary, type Relation } from "../../api/client";
import { EntityThumb } from "./EntityThumb";
import { EntityPicker } from "./EntityPicker";

const TYPE_LABELS: Record<CoreType, string> = {
  visit: "Places & visits", trip: "Trips", person: "People", media: "Photos", document: "Documents",
};

interface Props {
  entity: string;              // "person:<id>"
  addTypes?: CoreType[];       // types the user may link to this entity
}

export function RelatedPanel({ entity, addTypes = [] }: Props) {
  const qc = useQueryClient();
  const key = ["relations", entity];
  const { data: relations = [] } = useQuery({ queryKey: key, queryFn: () => api.getRelations(entity) });

  const add = useMutation({
    mutationFn: (picked: EntitySummary) => api.createLink(entity, `${picked.type}:${picked.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (linkId: string) => api.deleteLink(linkId),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const groups = new Map<CoreType, Relation[]>();
  for (const r of relations) groups.set(r.entity.type, [...(groups.get(r.entity.type) ?? []), r]);

  return (
    <div>
      <div className="section-title"><span>Related</span></div>
      {relations.length === 0 && <div className="er-sub">Nothing linked yet.</div>}
      {[...groups].map(([type, rels]) => (
        <div key={type} className="related-group">
          <h4>{TYPE_LABELS[type]}</h4>
          {rels.map((r) => (
            <span key={r.linkId} className="related-chip">
              <EntityThumb thumbUrl={r.entity.thumbUrl} label={r.entity.label} size={22} />
              {r.entity.label}
              <button aria-label={`Remove ${r.entity.label}`} onClick={() => remove.mutate(r.linkId)}>✕</button>
            </span>
          ))}
        </div>
      ))}
      {addTypes.map((t) => (
        <div key={t} style={{ marginTop: 8 }}>
          <EntityPicker type={t} placeholder={`Link a ${t}…`} onPick={(e) => add.mutate(e)} />
        </div>
      ))}
    </div>
  );
}
