import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Face, type FaceView } from "../../api/client";
import { EmptyState, ErrorState, SegmentedControl, Spinner } from "../kit";
import { ByFamily } from "../shared/ByFamily";
import { FaceAssign } from "./FaceAssign";

type Tab = Exclude<FaceView, "all">;

const EMPTY: Record<Tab, { title: string; hint: string }> = {
  review: {
    title: "No faces to review",
    hint: "When Immich recognises someone new in two or more photos, they'll wait here for you to say who they are.",
  },
  mapped: { title: "No faces matched yet", hint: "Faces you say who they are show here, with the person they're matched to." },
  ignored: { title: "Nothing ignored", hint: "Faces you don't keep (and people hidden in Immich) show here." },
};

/** The faces Immich found in the family's photos, and who each one is. */
export function FacesView() {
  const [tab, setTab] = useState<Tab>("review");
  const [open, setOpen] = useState<Face | null>(null);
  const { data: count } = useQuery({ queryKey: ["faces-count"], queryFn: api.facesCount });
  const { data: faces, isLoading, isError, refetch } = useQuery({ queryKey: ["faces", tab], queryFn: () => api.listFaces(tab) });
  const review = count?.review ?? 0;

  return (
    <div className="faces">
      <SegmentedControl
        label="Faces"
        value={tab}
        onChange={setTab}
        options={[
          { value: "review", label: review ? `To review (${review})` : "To review" },
          { value: "mapped", label: "Matched" },
          { value: "ignored", label: "Ignored" },
        ]}
      />
      {isError ? (
        <ErrorState hint="Couldn't load faces." onRetry={() => refetch()} />
      ) : isLoading ? (
        <Spinner label="Loading faces…" />
      ) : faces && faces.length ? (
        <ul className="face-grid" aria-label={tab === "review" ? "Faces to review" : tab === "mapped" ? "Matched faces" : "Ignored faces"}>
          {faces.map((f) => (
            <li key={f.id}>
              <button type="button" className="face-card" onClick={() => setOpen(f)}>
                <img className="face-thumb" src={f.thumbUrl} alt="" loading="lazy" />
                <span className="face-card-name">{f.person?.displayName ?? (f.name || "Who is this?")}</span>
                {f.person && <ByFamily name={f.person.familyName} />}
                <span className="er-sub">{f.photoCount ?? 0} photo{f.photoCount === 1 ? "" : "s"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={EMPTY[tab].title} hint={EMPTY[tab].hint} />
      )}
      {open && <FaceAssign face={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
