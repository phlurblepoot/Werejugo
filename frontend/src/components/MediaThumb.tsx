import { API_URL, type Photo } from "../api/client";

/** Renders a thumbnail for any media kind (image thumb, or a placeholder for video/audio). */
export function MediaThumb({ photo }: { photo: Photo }) {
  if (photo.mediaType === "image") {
    return <img src={`${API_URL}${photo.thumbUrl ?? photo.url}`} alt={photo.caption} loading="lazy" />;
  }
  return <div className="media-placeholder">{photo.mediaType === "video" ? "▶" : "🎵"}</div>;
}
