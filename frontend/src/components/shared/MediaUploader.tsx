import { useEffect, useRef, useState } from "react";
import type { MediaDto } from "../../api/client";
import { useUploads } from "../../lib/uploads/UploadsProvider";

interface Props {
  onUploaded: (media: MediaDto) => void;
  onAllUploaded?: (media: MediaDto[]) => void;
  linkTo?: string;        // e.g. "person:<id>" — the server links each upload to this entity
  linkRole?: string;
  multiple?: boolean;
  label?: string;
}

/** Photos and videos, including iPhone HEIC and camera RAW files (Immich reads them). */
export const MEDIA_ACCEPT = "image/*,video/*,.heic,.heif,.dng,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2";

/**
 * Pick photos or videos and upload them through the app's upload manager
 * (in pieces, resumable, shown in the upload tray). Links are made by the
 * server, so they happen even if this component is gone by then.
 */
export function MediaUploader({ onUploaded, onAllUploaded, linkTo, linkRole = "", multiple = false, label = "Upload" }: Props) {
  const uploads = useUploads();
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  // The latest callbacks, for uploads that finish after a re-render.
  const cb = useRef({ onUploaded, onAllUploaded });
  cb.current = { onUploaded, onAllUploaded };

  async function handle(files: File[]) {
    setPending((n) => n + 1);
    setError(null);
    setNote(null);
    const { done } = uploads.add(files, {
      linkTo, linkRole,
      onEach: (t) => { if (mounted.current && t.media) cb.current.onUploaded(t.media); },
    });
    const tasks = await done;
    if (!mounted.current) return;
    setPending((n) => n - 1);
    const media = tasks.flatMap((t) => (t.state === "done" && t.media ? [{ ...t.media, duplicate: t.duplicate }] : []));
    const failed = tasks.filter((t) => t.state === "failed");
    const dupes = media.filter((m) => m.duplicate).length;
    if (failed.length === 1 && tasks.length === 1) setError(failed[0].error ?? "Upload failed");
    else if (failed.length) setError(`${failed.length} couldn't be added (see Uploads)`);
    if (dupes) setNote(dupes === tasks.length && dupes === 1 ? "Already in your library" : `${dupes} already in your library`);
    if (media.length) cb.current.onAllUploaded?.(media);
  }

  const busy = pending > 0 && !multiple;
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
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (files.length) void handle(files);
          // Clear the choice, so picking the same file again still uploads it.
          e.target.value = "";
        }}
      />
      {error && <span className="error-text" style={{ marginLeft: 8 }}>{error}</span>}
      {note && !error && <span className="er-sub" role="status" style={{ marginLeft: 8 }}>{note}</span>}
    </label>
  );
}
