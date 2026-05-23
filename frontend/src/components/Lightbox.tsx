import { useEffect } from "react";
import { API_URL, type Photo } from "../api/client";

interface Props {
  photos: Photo[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

export function Lightbox({ photos, index, onIndex, onClose }: Props) {
  const photo = photos[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex((index + 1) % photos.length);
      if (e.key === "ArrowLeft") onIndex((index - 1 + photos.length) % photos.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onIndex, onClose]);

  if (!photo) return null;

  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>✕</button>
      {photos.length > 1 && (
        <button
          className="lightbox-nav left"
          onClick={(e) => {
            e.stopPropagation();
            onIndex((index - 1 + photos.length) % photos.length);
          }}
        >
          ‹
        </button>
      )}
      <figure className="lightbox-figure" onClick={(e) => e.stopPropagation()}>
        {photo.mediaType === "video" ? (
          <video src={`${API_URL}${photo.url}`} controls autoPlay style={{ maxWidth: "92vw", maxHeight: "84vh" }} />
        ) : photo.mediaType === "audio" ? (
          <div style={{ padding: 40 }}>
            <div style={{ fontSize: 64 }}>🎵</div>
            <audio src={`${API_URL}${photo.url}`} controls autoPlay />
          </div>
        ) : (
          <img src={`${API_URL}${photo.url}`} alt={photo.caption} />
        )}
        {photo.caption && <figcaption>{photo.caption}</figcaption>}
        {photos.length > 1 && (
          <div className="lightbox-count">{index + 1} / {photos.length}</div>
        )}
      </figure>
      {photos.length > 1 && (
        <button
          className="lightbox-nav right"
          onClick={(e) => {
            e.stopPropagation();
            onIndex((index + 1) % photos.length);
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}
