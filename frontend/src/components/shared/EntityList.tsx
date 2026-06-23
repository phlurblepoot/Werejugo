import { useState, type ReactNode } from "react";

interface Props<T> {
  items: T[];
  getKey: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  getSearchText?: (item: T) => string;
  onSelect?: (item: T) => void;
  searchPlaceholder?: string;
}

/** Generic searchable list of entities. */
export function EntityList<T>({ items, getKey, renderRow, getSearchText, onSelect, searchPlaceholder }: Props<T>) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const filtered = term && getSearchText
    ? items.filter((i) => getSearchText(i).toLowerCase().includes(term))
    : items;

  return (
    <div>
      {getSearchText && (
        <input value={q} placeholder={searchPlaceholder ?? "Search…"} onChange={(e) => setQ(e.target.value)} />
      )}
      <div style={{ marginTop: 8 }}>
        {filtered.map((item) => (
          <div key={getKey(item)} className="entity-row" onClick={() => onSelect?.(item)}>
            {renderRow(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
