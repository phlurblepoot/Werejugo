import { useEffect, useRef, useState } from "react";
import type { PlaceSuggestion } from "../api/client";

interface Props {
  placeholder?: string;
  search: (q: string) => Promise<PlaceSuggestion[]>;
  onSelect: (s: PlaceSuggestion) => void;
}

export function PlaceSearch({ placeholder, search, onSelect }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        setResults(await search(q));
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, search]);

  return (
    <div style={{ position: "relative" }}>
      <input
        value={q}
        placeholder={placeholder ?? "Search…"}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="suggestions">
          {results.map((r, i) => (
            <div
              key={i}
              onClick={() => {
                onSelect(r);
                setQ("");
                setResults([]);
                setOpen(false);
              }}
            >
              {r.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
