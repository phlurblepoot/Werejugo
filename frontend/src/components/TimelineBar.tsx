import { useEffect, useRef, useState } from "react";
import type { Item } from "../api/client";

interface Props {
  items: Item[];
  cursor: string | null;
  onCursor: (date: string) => void;
  onClose: () => void;
  /** Items without a date: shown on the map while the timeline plays, or hidden. */
  showUndated: boolean;
  onShowUndated: (show: boolean) => void;
}

const DAY = 86400000;
const toDay = (s: string) => Math.floor(Date.parse(s) / DAY);
const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BUCKETS = 48;

/**
 * Marks along the timeline between two dates: years' starts over a long span
 * (round ones when there are many), months' over a short one (every third when
 * over a year). `at` is 0–1.
 */
export function timelineTicks(from: string, to: string): Array<{ at: number; label: string }> {
  const a = toDay(from);
  const b = toDay(to);
  const span = Math.max(1, b - a);
  const out: Array<{ at: number; label: string }> = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (span > 730) {
    // At most about eight: every year, or every 2nd, 5th, 10th… (round years).
    const step = [1, 2, 5, 10, 20, 50].find((n) => (ty - fy) / n <= 8) ?? 100;
    for (let y = fy + 1; y <= ty; y++) if (y % step === 0) out.push({ at: (toDay(`${y}-01-01`) - a) / span, label: String(y) });
  } else {
    const months = (ty - fy) * 12 + (tm - fm);
    const every = months > 12 ? 3 : 1;
    for (let i = 1; i <= months; i++) {
      const y = fy + Math.floor((fm - 1 + i) / 12);
      const m = (fm - 1 + i) % 12;
      if (i % every) continue;
      out.push({ at: (toDay(`${y}-${String(m + 1).padStart(2, "0")}-01`) - a) / span, label: m === 0 ? String(y) : MONTHS[m] });
    }
  }
  return out.filter((t) => t.at > 0 && t.at < 1);
}

export function TimelineBar({ items, cursor, onCursor, onClose, showUndated, onShowUndated }: Props) {
  const dated = items.map((i) => i.occurredOn).filter((d): d is string => !!d).sort();
  const undated = items.length - dated.length;
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const minDay = dated.length ? toDay(dated[0]) : 0;
  const maxDay = dated.length ? toDay(dated[dated.length - 1]) : 0;
  const curDay = cursor ? toDay(cursor) : maxDay;
  const span = Math.max(1, maxDay - minDay);

  // How many items fall in each part of the span.
  const counts = new Array<number>(BUCKETS).fill(0);
  for (const d of dated) counts[Math.min(BUCKETS - 1, Math.floor(((toDay(d) - minDay) / span) * BUCKETS))]++;
  const most = Math.max(1, ...counts);

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
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
  }, [playing, cursor, minDay, maxDay, span, onCursor]);

  const undatedChip = undated > 0 && (
    <button type="button" className={`chip ${showUndated ? "active" : ""}`} aria-pressed={showUndated}
      title={showUndated ? "Shown on the map whatever the date: click to hide them" : "Hidden: click to show them"}
      onClick={() => onShowUndated(!showUndated)}>
      No date ({undated})
    </button>
  );

  return (
    <div className="timeline-bar">
      <button className="ghost" onClick={onClose} aria-label="Close the timeline">✕</button>
      {dated.length < 1 ? (
        <>
          <span style={{ color: "var(--color-text-muted)", fontSize: 13, flex: 1 }}>Add dates to items to use the timeline.</span>
          {undatedChip}
        </>
      ) : (
        <>
          <button
            className="primary"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              if (curDay >= maxDay) onCursor(fromDay(minDay));
              setPlaying((p) => !p);
            }}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <div className="timeline-track">
            <div className="timeline-density" aria-hidden="true">
              {counts.map((n, i) => <span key={i} style={{ height: `${Math.round((n / most) * 100)}%` }} />)}
            </div>
            <input
              type="range"
              aria-label="Show places up to"
              min={minDay}
              max={maxDay}
              value={curDay}
              onChange={(e) => {
                setPlaying(false);
                onCursor(fromDay(Number(e.target.value)));
              }}
            />
            <div className="timeline-ticks" aria-hidden="true">
              {timelineTicks(dated[0], dated[dated.length - 1]).map((t) => (
                <span key={`${t.label}${t.at}`} style={{ left: `${t.at * 100}%` }}>{t.label}</span>
              ))}
            </div>
          </div>
          <span className="timeline-date">{fromDay(curDay)}</span>
          {undatedChip}
        </>
      )}
    </div>
  );
}
