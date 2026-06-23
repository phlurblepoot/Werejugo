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

/** Generic media upload: uploads each file, optionally links it, reports each media. */
export function MediaUploader({ onUploaded, onAllUploaded, linkTo, linkRole = "", multiple = false, label = "Upload" }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(files: FileList) {
    setBusy(true);
    setError(null);
    try {
      const media = await Promise.all(
        Array.from(files).map(async (file) => {
          const m = await api.uploadMedia(file);
          if (linkTo) await api.createLink(`media:${m.id}`, linkTo, linkRole);
          onUploaded(m);
          return m;
        }),
      );
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
        accept="image/*,video/*,audio/*"
        multiple={multiple}
        hidden
        disabled={busy}
        onChange={(e) => e.target.files?.length && handle(e.target.files)}
      />
      {error && <span className="error-text" style={{ marginLeft: 8 }}>{error}</span>}
    </label>
  );
}
