import { useEffect, useRef, useState } from "react";

interface Item {
  name: string;
  url: string;
}

interface Props {
  value: string;
  placeholder?: string;
  confirmed?: boolean;
  search: (q: string) => Promise<Item[]>;
  onText: (text: string) => void;
  onPick: (item: Item) => void;
}

/** Free-text input with a debounced suggestion dropdown (cruise lines / ships). */
export function Autocomplete({ value, placeholder, confirmed, search, onText, onPick }: Props) {
  const [results, setResults] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNext = useRef(false);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await searchRef.current(value);
        setResults(r);
        setOpen(r.length > 0);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value]);

  return (
    <div style={{ position: "relative", flex: 1 }}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onText(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={confirmed ? { borderColor: "#16a34a" } : undefined}
      />
      {confirmed && (
        <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#16a34a", pointerEvents: "none" }}>✓</span>
      )}
      {open && results.length > 0 && (
        <div className="suggestions">
          {results.map((r, i) => (
            <div
              key={i}
              onMouseDown={(e) => {
                e.preventDefault();
                skipNext.current = true;
                onPick(r);
                setOpen(false);
              }}
            >
              {r.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
