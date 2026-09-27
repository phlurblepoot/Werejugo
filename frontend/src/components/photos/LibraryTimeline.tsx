import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check } from "lucide-react";
import { API_URL, type MediaFilters, type MediaItem } from "../../api/client";
import { layoutTimeline, monthsInRows } from "../../lib/timelineLayout";
import { ByFamily, otherFamily } from "../shared/ByFamily";
import { MediaImage } from "../shared/MediaImage";
import { fetchMonth, monthKey, useTimeline } from "./useLibrary";
import { formatDuration } from "../../lib/dates";

export interface TimelineSelection {
  selected: ReadonlySet<string>;
  /** A tap toggles one photo; Shift+click passes the photos between the last tap and this one. */
  onToggle: (item: MediaItem, range: MediaItem[] | null) => void;
}

interface Props {
  filters: MediaFilters;
  onOpen?: (item: MediaItem) => void;
  selection?: TimelineSelection;
  /** A long press (phones) or right-click starts selecting with this photo. */
  onLongPress?: (item: MediaItem) => void;
  /** Open scrolled to this month ("2025-07"), or the nearest older one. */
  initialMonth?: string | null;
  myFamilyId?: string;
  /** Something extra on a photo (the picker's "Added"). */
  badge?: (item: MediaItem) => ReactNode;
  empty?: ReactNode;
  /** jsdom and first paint: the size to lay out for before it's measured. */
  initialSize?: { width: number; height: number };
}

const RAIL = 44;
const NO_MONTHS: Array<{ month: string; count: number }> = [];

/**
 * The photo library as one long timeline: laid out from per-month counts,
 * with only the rows on screen rendered and only their months fetched, so a
 * library of 20,000+ photos scrolls (and jumps to any year) smoothly.
 */
export function LibraryTimeline({ filters, onOpen, selection, onLongPress, initialMonth, myFamilyId, badge, empty, initialSize }: Props) {
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initialSize?.width ?? 0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth) setWidth(el.clientWidth); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const timeline = useTimeline(filters);
  const months = timeline.data?.months ?? NO_MONTHS;
  const phone = width > 0 && width < 600;
  const layout = useMemo(
    () => layoutTimeline(months, Math.max(0, width - RAIL - 16), { target: phone ? 110 : 150, gap: phone ? 2 : 4 }),
    [months, width, phone],
  );

  const virt = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => layout.rows[i]?.height ?? 40,
    overscan: 4,
    initialRect: initialSize,
    // Re-measuring after a layout change happens in an effect; don't flushSync there.
    useFlushSync: false,
  });
  useEffect(() => { virt.measure(); }, [layout, virt]);

  // Open at a month once, when the layout first knows it.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !initialMonth || !layout.rows.length) return;
    opened.current = true;
    const target = months.find((m) => m.month <= initialMonth && m.count > 0)?.month ?? months.at(-1)?.month;
    const row = target ? layout.monthRow.get(target) : undefined;
    if (row !== undefined) virt.scrollToIndex(row, { align: "start" });
  }, [initialMonth, layout, months, virt]);

  const vItems = virt.getVirtualItems();
  const onScreen = vItems.length ? monthsInRows(layout, vItems[0].index, vItems[vItems.length - 1].index) : [];
  const monthData = useQueries({
    queries: onScreen.map((m) => ({ queryKey: monthKey(filters, m), queryFn: () => fetchMonth(filters, m), staleTime: 60_000 })),
  });
  const byMonth = new Map(onScreen.map((m, i) => [m, monthData[i]?.data]));

  // Shift+click: every loaded photo between the last tap and this one, in order.
  const lastTap = useRef<string | null>(null);
  function rangeTo(item: MediaItem): MediaItem[] | null {
    if (!lastTap.current) return null;
    const all = months.flatMap((m) => qc.getQueryData<MediaItem[]>(monthKey(filters, m.month)) ?? []);
    const a = all.findIndex((m) => m.id === lastTap.current);
    const b = all.findIndex((m) => m.id === item.id);
    if (a < 0 || b < 0) return null;
    return all.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  function startPress(item: MediaItem) {
    if (!onLongPress) return;
    const p = { timer: 0, fired: false };
    p.timer = window.setTimeout(() => { p.fired = true; onLongPress(item); }, 500);
    press.current = p;
  }
  const endPress = () => { if (press.current) window.clearTimeout(press.current.timer); };

  function tap(item: MediaItem, e: React.MouseEvent) {
    if (press.current?.fired) { press.current = null; return; }
    if (selection) {
      selection.onToggle(item, e.shiftKey ? rangeTo(item) : null);
      lastTap.current = item.id;
    } else {
      onOpen?.(item);
    }
  }

  if (timeline.isSuccess && months.length === 0) return <>{empty}</>;

  return (
    <div className="lib" data-testid="library-timeline">
      <div ref={scrollRef} className="lib-scroll">
        <div className="lib-canvas" style={{ height: virt.getTotalSize(), marginRight: RAIL }}>
          {vItems.map((v) => {
            const row = layout.rows[v.index];
            if (!row) return null;
            if (row.kind === "header") {
              const count = months.find((m) => m.month === row.month)?.count ?? 0;
              return (
                <div key={v.key} className="lib-header" style={{ transform: `translateY(${v.start}px)`, height: row.height }}>
                  {row.label} <span className="er-sub">· {count}</span>
                </div>
              );
            }
            const items = byMonth.get(row.month);
            return (
              <div key={v.key} className="lib-row" style={{ transform: `translateY(${v.start}px)`, height: row.height, gap: layout.gap, gridTemplateColumns: `repeat(${layout.columns}, ${layout.cell}px)` }}>
                {Array.from({ length: row.count }, (_, i) => {
                  const m = items?.[row.start + i];
                  if (!m) return <div key={i} className="lib-cell lib-placeholder" style={{ height: layout.cell }} />;
                  const on = selection?.selected.has(m.id) ?? false;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`lib-cell photo-cell${on ? " is-selected" : ""}`}
                      style={{ height: layout.cell }}
                      title={m.caption || m.originalName || undefined}
                      aria-pressed={selection ? on : undefined}
                      aria-label={`${m.kind === "video" ? "Video" : "Photo"}${m.caption ? `: ${m.caption}` : ""}`}
                      onClick={(e) => tap(m, e)}
                      onContextMenu={(e) => { if (onLongPress && !selection) { e.preventDefault(); onLongPress(m); } }}
                      onPointerDown={() => startPress(m)}
                      onPointerUp={endPress}
                      onPointerLeave={endPress}
                    >
                      {m.thumbUrl ? <MediaImage src={`${API_URL}${m.thumbUrl}`} alt="" loading="lazy" /> : <span className="media-placeholder">▶</span>}
                      {m.kind === "video" && <span className="play-badge" aria-hidden="true">▶{m.durationMs ? ` ${formatDuration(m.durationMs)}` : ""}</span>}
                      <ByFamily name={otherFamily(m, myFamilyId)} />
                      {badge?.(m)}
                      {selection && <span className={`lib-check${on ? " on" : ""}`} aria-hidden="true">{on && <Check size={14} />}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {layout.years.length > 1 && (
        <nav className="lib-years" aria-label="Jump to year">
          {layout.years.map((y) => (
            <button key={y.year} type="button" onClick={() => virt.scrollToIndex(layout.monthRow.get(y.month)!, { align: "start" })}>
              {phone ? `'${y.year.slice(2)}` : y.year}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
