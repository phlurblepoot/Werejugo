import { useEffect, useRef, useState } from "react";
import { api, type CoreType, type EntitySummary } from "../../api/client";
import { EntityThumb } from "./EntityThumb";

interface Props {
  type: CoreType;
  onPick: (entity: EntitySummary) => void;
  placeholder?: string;
}

export function EntityPicker({ type, onPick, placeholder }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<EntitySummary[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 1) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await api.searchEntities(type, q.trim());
        setResults(r);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, type]);

  return (
    <div className="picker-wrap">
      <input
        value={q}
        placeholder={placeholder ?? `Search ${type}…`}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div className="suggestions">
          {results.map((r) => (
            <div
              key={r.id}
              className="entity-row"
              onMouseDown={(e) => { e.preventDefault(); onPick(r); setQ(""); setResults([]); setOpen(false); }}
            >
              <EntityThumb thumbUrl={r.thumbUrl} label={r.label} size={24} />
              <span className="er-main"><span className="er-title">{r.label}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
