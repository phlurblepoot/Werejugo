import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { API_URL, api, type Suggestion } from "../../api/client";
import { formatDate, formatDateRange } from "../../lib/dates";
import { useToast } from "../Toast";
import { Button, IconButton } from "../kit";
import { ByFamily } from "../shared/ByFamily";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const photos = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;

/** What a suggestion says, and its main button. */
export function describe(s: Suggestion): { title: string; detail: string; action: string; nameField?: string } {
  switch (s.kind) {
    case "trip-photos":
      return { title: `${photos(s.count)} taken during this trip`, detail: "They aren't in any trip yet.", action: s.count === 1 ? "Add it" : "Add them" };
    case "visit-photos":
      return { title: `${photos(s.count)} taken here`, detail: "Taken around its dates, within 2 km.", action: s.count === 1 ? "Add it" : "Add them" };
    case "trip-place":
      return {
        title: `You took ${photos(s.count)} ${s.label ? `near ${s.label}` : "somewhere that isn't a place on this trip"}`,
        detail: s.startDate ? `From ${formatDate(s.startDate)}. Add it as a place?` : "Add it as a place?",
        action: "Add place", nameField: "Place name",
      };
    case "trip-person":
      return { title: `${s.person?.displayName ?? "Someone"} is in ${photos(s.count)} from this trip`, detail: "They aren't on the trip yet.", action: "Add to trip" };
    case "new-trip":
      return {
        title: `Looks like you were ${s.label ? `in ${s.label}` : "away"}`,
        detail: `${formatDateRange(s.startDate ?? null, s.endDate ?? null)} · ${photos(s.count)} in no trip`,
        action: "Create trip", nameField: "Trip name",
      };
  }
}

/** Refresh what applying a suggestion can change. */
function invalidate(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ["suggestions", "media", "trips", "visits", "relations", "trip-album", "activity"]) qc.invalidateQueries({ queryKey: [key] });
}

export function SuggestionCard({ s, onReview, onApplied }: {
  s: Suggestion;
  /** Photo suggestions: choose them in the picker instead. */
  onReview?: () => void;
  onApplied?: (r: { tripId?: string; visitId?: string }) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const text = describe(s);
  const [name, setName] = useState(s.kind === "new-trip" ? s.name ?? "" : s.label ?? "");
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    try {
      const r = await api.applySuggestion(s.key, text.nameField ? name : undefined);
      invalidate(qc);
      toast(
        s.kind === "new-trip" ? `Created “${name}” with ${photos(r.attached ?? 0)}`
          : s.kind === "trip-place" ? `Added “${name || "the place"}” with ${photos(r.attached ?? 0)}`
          : s.kind === "trip-person" ? `${s.person?.displayName} is on the trip`
          : `Added ${photos(r.attached ?? 0)}`,
        "success");
      onApplied?.(r);
    } catch (e) {
      toast(errText(e), "error");
      invalidate(qc);
    } finally {
      setBusy(false);
    }
  }
  async function dismiss() {
    try {
      await api.dismissSuggestion(s.key);
      qc.invalidateQueries({ queryKey: ["suggestions"] });
    } catch (e) {
      toast(errText(e), "error");
    }
  }

  return (
    <li className="sugg-card">
      <div className="sugg-main">
        <div className="sugg-title">
          {text.title}
          {s.kind === "trip-person" && s.person?.familyName && <> <ByFamily name={s.person.familyName} /></>}
        </div>
        <div className="er-sub">{text.detail}</div>
        {s.thumbUrls.length > 0 && (
          <div className="sugg-thumbs" aria-hidden="true">
            {s.thumbUrls.map((u) => <img key={u} src={`${API_URL}${u}`} alt="" loading="lazy" />)}
          </div>
        )}
        {text.nameField && (
          <input className="sugg-name" aria-label={text.nameField} value={name} placeholder={text.nameField} onChange={(e) => setName(e.target.value)} />
        )}
        <div className="sugg-actions">
          <Button size="sm" variant="primary" disabled={busy || (s.kind === "new-trip" && !name.trim())} onClick={apply}>{text.action}</Button>
          {onReview && <Button size="sm" variant="ghost" onClick={onReview}>Review</Button>}
        </div>
      </div>
      <IconButton label="Not now" icon={X} size="sm" onClick={dismiss} />
    </li>
  );
}

/** The suggestions for a trip, a place, or the library (`target`); nothing when there are none. */
export function Suggestions({ target, title = "Suggestions", onReview, onApplied }: {
  target: string;
  title?: string;
  onReview?: () => void;
  onApplied?: (r: { tripId?: string; visitId?: string }) => void;
}) {
  const { data } = useQuery({ queryKey: ["suggestions", target], queryFn: () => api.listSuggestions(target) });
  const items = data?.items ?? [];
  if (!items.length) return null;
  const photoKinds = new Set(["trip-photos", "visit-photos"]);
  return (
    <section className="sugg-section" aria-label={title}>
      <div className="section-title"><span><Sparkles size={14} aria-hidden="true" /> {title}</span></div>
      <ul className="sugg-list">
        {items.map((s) => (
          <SuggestionCard key={s.key} s={s} onReview={photoKinds.has(s.kind) ? onReview : undefined} onApplied={onApplied} />
        ))}
      </ul>
    </section>
  );
}
