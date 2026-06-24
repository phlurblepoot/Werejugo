import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type PackingItem } from "../../api/client";

interface Props { listId: string; items: PackingItem[]; readOnly?: boolean; onChanged: () => void }

export function PackingChecklist({ listId, items, readOnly = false, onChanged }: Props) {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const toggle = useMutation({ mutationFn: (v: { id: string; checked: boolean }) => api.updatePackingItem(v.id, { checked: v.checked }), onSuccess: onChanged });
  const add = useMutation({ mutationFn: () => api.addPackingItem(listId, { label: label.trim(), category: category.trim() || undefined }), onSuccess: () => { setLabel(""); setCategory(""); onChanged(); } });
  const del = useMutation({ mutationFn: (id: string) => api.deletePackingItem(id), onSuccess: onChanged });

  const groups = new Map<string, PackingItem[]>();
  for (const it of items) { const k = it.category || "Other"; groups.set(k, [...(groups.get(k) ?? []), it]); }
  const checked = items.filter((i) => i.checked).length;

  return (
    <div>
      <div className="er-sub">{checked}/{items.length} packed</div>
      {[...groups].map(([cat, its]) => (
        <div key={cat} className="pack-group">
          <div className="cat-hdr">{cat}</div>
          {its.map((i) => (
            <div key={i.id} className="pack-item">
              <input type="checkbox" aria-label={i.label} checked={i.checked} disabled={readOnly}
                onChange={(e) => toggle.mutate({ id: i.id, checked: e.target.checked })} />
              <span className={i.checked ? "done" : ""}>{i.qty ? `${i.qty}× ` : ""}{i.label}</span>
              {!readOnly && <button className="ghost" aria-label={`Remove ${i.label}`} onClick={() => del.mutate(i.id)}>✕</button>}
            </div>
          ))}
        </div>
      ))}
      {!readOnly && (
        <div className="row" style={{ marginTop: 6 }}>
          <input value={label} placeholder="Add item…" onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && label.trim() && add.mutate()} />
          <input value={category} placeholder="Category" style={{ maxWidth: 110 }} onChange={(e) => setCategory(e.target.value)} />
          <button style={{ flex: "0 0 auto" }} disabled={!label.trim()} onClick={() => label.trim() && add.mutate()}>Add</button>
        </div>
      )}
    </div>
  );
}
