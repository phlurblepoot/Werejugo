import { useEffect, useRef } from "react";
import { API_URL, type Photo } from "../api/client";

interface Props {
  photos: Photo[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

export function Lightbox({ photos, index, onIndex, onClose }: Props) {
  const photo = photos[index];
  const next = () => onIndex((index + 1) % photos.length);
  const prev = () => onIndex((index - 1 + photos.length) % photos.length);
  const touchStartX = useRef<number | null>(null);

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

  // Swipe left/right to navigate on touch devices.
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || photos.length < 2) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx > 50) prev();
    else if (dx < -50) next();
    touchStartX.current = null;
  }

  return (
    <div className="lightbox" onClick={onClose} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close" title="Close (Esc)">✕</button>
      {photos.length > 1 && (
        <button
          className="lightbox-nav left"
          aria-label="Previous photo"
          title="Previous (←)"
          onClick={(e) => {
            e.stopPropagation();
            prev();
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
          aria-label="Next photo"
          title="Next (→)"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}
