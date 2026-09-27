import { useState } from "react";
import { Link } from "react-router-dom";
import { Images } from "lucide-react";
import { api, type Face } from "../../api/client";
import { useTimeline } from "../photos/useLibrary";
import { useQuery } from "@tanstack/react-query";
import { FaceAssign } from "./FaceAssign";

/**
 * A person's photos: how many there are (tagged by hand or by their face),
 * a link to them in the library, and the faces matched to them.
 */
export function PersonFaces({ personId, personName }: { personId: string; personName: string }) {
  const [open, setOpen] = useState<Face | null>(null);
  const { data: faces = [] } = useQuery({ queryKey: ["person-faces", personId], queryFn: () => api.personFaces(personId) });
  const { data: timeline } = useTimeline({ person: personId });
  const total = timeline?.total ?? 0;

  return (
    <section className="person-photos" aria-label={`Photos of ${personName}`}>
      <div className="person-photos-head">
        <h3>Photos</h3>
        {total > 0 && (
          <Link className="kit-btn kit-btn-ghost kit-btn-sm" to={`/photos?person=${personId}`}>
            <Images size={16} aria-hidden="true" /> <span>See {total} photo{total === 1 ? "" : "s"}</span>
          </Link>
        )}
      </div>
      {faces.length > 0 && (
        <div className="person-faces">
          <span className="er-sub">Found in photos by {faces.length === 1 ? "their face" : `${faces.length} faces`}:</span>
          <ul className="face-strip">
            {faces.map((f) => (
              <li key={f.id}>
                <button type="button" className="face-mini" onClick={() => setOpen(f)} aria-label={`Face in ${f.photoCount ?? 0} photos`}>
                  <img className="face-thumb" src={f.thumbUrl} alt="" loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {total === 0 && faces.length === 0 && <p className="er-sub">No photos of {personName} yet.</p>}
      {open && <FaceAssign face={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
