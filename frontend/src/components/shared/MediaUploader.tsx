import { useState } from "react";
import { api, type MediaDto } from "../../api/client";

interface Props {
  onUploaded: (media: MediaDto) => void;
  onAllUploaded?: (media: MediaDto[]) => void;
  linkTo?: string;        // e.g. "person:<id>" — links each upload to this entity
  linkRole?: string;
  multiple?: boolean;
  label?: string;
}

/** Photos and videos, including iPhone HEIC and camera RAW files (Immich reads them). */
export const MEDIA_ACCEPT = "image/*,video/*,.heic,.heif,.dng,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2";

/** Generic media upload: uploads each file, optionally links it, reports each media. */
export function MediaUploader({ onUploaded, onAllUploaded, linkTo, linkRole = "", multiple = false, label = "Upload" }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function handle(files: FileList) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const media = await Promise.all(
        Array.from(files).map(async (file) => {
          const m = await api.uploadMedia(file);
          if (linkTo) await api.createLink(`media:${m.id}`, linkTo, linkRole);
          onUploaded(m);
          return m;
        }),
      );
      const dupes = media.filter((m) => m.duplicate).length;
      if (dupes) setNote(dupes === media.length && dupes === 1 ? "Already in your library" : `${dupes} already in your library`);
      onAllUploaded?.(media);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="filebtn">
      {busy ? "Uploading…" : label}
      <input
        data-testid="media-input"
        type="file"
        accept={MEDIA_ACCEPT}
        multiple={multiple}
        hidden
        disabled={busy}
        onChange={(e) => {
          const files = e.target.files;
          if (files?.length) void handle(files);
          // Clear the choice, so picking the same file again still uploads it.
          e.target.value = "";
        }}
      />
      {error && <span className="error-text" style={{ marginLeft: 8 }}>{error}</span>}
      {note && !error && <span className="er-sub" role="status" style={{ marginLeft: 8 }}>{note}</span>}
    </label>
  );
}
