import { useMemo } from "react";
import type { FamilySettings, Item, ItemKind, Theme } from "../api/client";
import { inheritedStyle, KIND_LABELS } from "../lib/style";
import { glyphFor } from "../lib/icons";

interface Props {
  items: Item[];
  kindFilter: ItemKind[];
  onToggleKind: (k: ItemKind) => void;
  /** The family's defaults: the legend shows the pins as the map draws them. */
  settings?: FamilySettings;
}

const NO_THEMES = new Map<string, Theme>();

export function Legend({ items, kindFilter, onToggleKind, settings }: Props) {
  const counts = new Map<ItemKind, number>();
  const lines = new Map<string, number>();
  for (const i of items) {
    counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
    const line = typeof i.properties?.cruiseLine === "string" ? i.properties.cruiseLine : "";
    // A cruise line with a look of its own gets its own row.
    if (i.kind === "cruise" && line && settings?.pin?.byLine?.[line]) lines.set(line, (lines.get(line) ?? 0) + 1);
  }
  const kinds = [...counts.keys()];
  const look = useMemo(
    () => (kind: ItemKind, cruiseLine?: string) => inheritedStyle(kind, { cruiseLine }, NO_THEMES, settings),
    [settings],
  );
  if (kinds.length === 0) return null;

  const shown = (k: ItemKind) => kindFilter.length === 0 || kindFilter.includes(k);

  return (
    <div className="legend">
      {kinds.map((k) => {
        const s = look(k);
        return (
          <div key={k}>
            <div className={`legend-row ${shown(k) ? "" : "off"}`} onClick={() => onToggleKind(k)} title="Click to toggle this layer">
              <span className="legend-swatch" style={{ background: s.color }}>{glyphFor(s.icon)}</span>
              <span className="legend-label">{KIND_LABELS[k] ?? k}</span>
              <span className="legend-count">{counts.get(k)}</span>
            </div>
            {k === "cruise" && [...lines].map(([line, n]) => {
              const ls = look("cruise", line);
              return (
                <div key={line} className={`legend-row legend-sub ${shown(k) ? "" : "off"}`}>
                  <span className="legend-swatch" style={{ background: ls.color }}>{glyphFor(ls.icon)}</span>
                  <span className="legend-label">{line}</span>
                  <span className="legend-count">{n}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
