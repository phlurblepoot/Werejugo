import { useState } from "react";
import { api, type Photo } from "../../api/client";
import { MediaThumb } from "../MediaThumb";
import { MediaUploader } from "../shared/MediaUploader";

export interface StagedPhoto { file: File; caption: string; preview: string }

interface Props {
  visitId: string | null;                 // null while the visit is unsaved
  existing: Photo[];
  staged: StagedPhoto[];
  onStaged: (staged: StagedPhoto[]) => void;
  onExistingChanged: () => void;           // refresh after add/delete on a saved visit
}

export function VisitPhotos({ visitId, existing, staged, onStaged, onExistingChanged }: Props) {
  const [local, setLocal] = useState<Photo[]>(existing);

  function addFiles(files: FileList) {
    const next = Array.from(files).map((file) => ({ file, caption: "", preview: URL.createObjectURL(file) }));
    onStaged([...staged, ...next]);
  }
  function removeStaged(i: number) {
    URL.revokeObjectURL(staged[i].preview);
    onStaged(staged.filter((_, j) => j !== i));
  }
  async function deleteExisting(id: string) {
    await api.deletePhoto(id);
    setLocal((prev) => prev.filter((p) => p.id !== id));
  }
  async function saveCaption(id: string, caption: string) {
    setLocal((prev) => prev.map((p) => (p.id === id ? { ...p, caption } : p)));
    await api.updatePhoto(id, caption);
  }

  return (
    <div className="field">
      <label>Photos</label>
      <div className="photo-grid">
        {local.map((p) => (
          <div key={p.id} className="photo-tile">
            <MediaThumb photo={p} />
            <button type="button" className="photo-remove" onClick={() => deleteExisting(p.id)}>✕</button>
            <input className="photo-caption" defaultValue={p.caption} placeholder="Caption…"
              onBlur={(e) => e.target.value !== p.caption && saveCaption(p.id, e.target.value)} />
          </div>
        ))}
        {staged.map((p, i) => (
          <div key={i} className="photo-tile">
            {p.file.type.startsWith("image") ? <img src={p.preview} alt="" />
              : <div className="media-placeholder">{p.file.type.startsWith("video") ? "▶" : "🎵"}</div>}
            <button type="button" className="photo-remove" onClick={() => removeStaged(i)}>✕</button>
            <input className="photo-caption" value={p.caption} placeholder="Caption…"
              onChange={(e) => onStaged(staged.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
          </div>
        ))}
      </div>

      {visitId ? (
        // Saved visit: upload + link immediately via the shared component.
        <MediaUploader multiple linkTo={`visit:${visitId}`} label="+ Add photos" onUploaded={onExistingChanged} />
      ) : (
        <>
          <input data-testid="visit-photo-input" type="file" accept="image/*,video/*,audio/*" multiple style={{ marginTop: 8 }}
            onChange={(e) => e.target.files && addFiles(e.target.files)} />
          {staged.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{staged.length} photo(s) will upload when you save.</div>
          )}
        </>
      )}
    </div>
  );
}
