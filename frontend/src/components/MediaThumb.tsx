import { API_URL, type Photo } from "../api/client";
import { MediaImage } from "./shared/MediaImage";

/** A thumbnail for a photo or video (videos get a play badge); audio gets a placeholder. */
export function MediaThumb({ photo }: { photo: Photo }) {
  if (photo.mediaType === "audio" || (!photo.thumbUrl && photo.mediaType !== "image")) {
    return <div className="media-placeholder">{photo.mediaType === "video" ? "▶" : "🎵"}</div>;
  }
  return (
    <>
      <MediaImage src={`${API_URL}${photo.thumbUrl ?? photo.url}`} alt={photo.caption} loading="lazy" />
      {photo.mediaType === "video" && <span className="play-badge" aria-label="Video">▶</span>}
    </>
  );
}
