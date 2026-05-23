import { useEffect, useRef, useState } from "react";
import type { Item } from "../api/client";

interface Props {
  items: Item[];
  cursor: string | null;
  onCursor: (date: string) => void;
  onClose: () => void;
}

const DAY = 86400000;
const toDay = (s: string) => Math.floor(Date.parse(s) / DAY);
const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

export function TimelineBar({ items, cursor, onCursor, onClose }: Props) {
  const dated = items.map((i) => i.occurredOn).filter((d): d is string => !!d).sort();
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const minDay = dated.length ? toDay(dated[0]) : 0;
  const maxDay = dated.length ? toDay(dated[dated.length - 1]) : 0;
  const curDay = cursor ? toDay(cursor) : maxDay;

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    const span = Math.max(1, maxDay - minDay);
    const step = Math.max(1, Math.round(span / 60));
    timer.current = setInterval(() => {
      const next = (cursor ? toDay(cursor) : minDay) + step;
      if (next >= maxDay) {
        onCursor(fromDay(maxDay));
        setPlaying(false);
      } else {
        onCursor(fromDay(next));
      }
    }, 350);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, cursor, minDay, maxDay, onCursor]);

  return (
    <div className="timeline-bar">
      <button className="ghost" onClick={onClose}>✕</button>
      {dated.length < 1 ? (
        <span style={{ color: "var(--muted)", fontSize: 13 }}>Add dates to items to use the timeline.</span>
      ) : (
        <>
          <button
            className="primary"
            onClick={() => {
              if (curDay >= maxDay) onCursor(fromDay(minDay));
              setPlaying((p) => !p);
            }}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <input
            type="range"
            min={minDay}
            max={maxDay}
            value={curDay}
            onChange={(e) => {
              setPlaying(false);
              onCursor(fromDay(Number(e.target.value)));
            }}
            style={{ flex: 1 }}
          />
          <span className="timeline-date">{fromDay(curDay)}</span>
        </>
      )}
    </div>
  );
}
