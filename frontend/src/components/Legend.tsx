import type { Item, ItemKind } from "../api/client";
import { KIND_DEFAULTS, KIND_LABELS } from "../lib/style";
import { glyphFor } from "../lib/icons";

interface Props {
  items: Item[];
  kindFilter: ItemKind[];
  onToggleKind: (k: ItemKind) => void;
}

export function Legend({ items, kindFilter, onToggleKind }: Props) {
  const counts = new Map<ItemKind, number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  const kinds = [...counts.keys()];
  if (kinds.length === 0) return null;

  const shown = (k: ItemKind) => kindFilter.length === 0 || kindFilter.includes(k);

  return (
    <div className="legend">
      {kinds.map((k) => (
        <div
          key={k}
          className={`legend-row ${shown(k) ? "" : "off"}`}
          onClick={() => onToggleKind(k)}
          title="Click to toggle this layer"
        >
          <span className="legend-swatch" style={{ background: KIND_DEFAULTS[k].color }}>
            {glyphFor(KIND_DEFAULTS[k].icon)}
          </span>
          <span className="legend-label">{KIND_LABELS[k]}</span>
          <span className="legend-count">{counts.get(k)}</span>
        </div>
      ))}
    </div>
  );
}
