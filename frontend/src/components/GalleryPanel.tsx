import { API_URL, type Item, type Photo } from "../api/client";

interface Props {
  items: Item[];
  onClose: () => void;
  onOpen: (photos: Photo[], index: number) => void;
}

export function GalleryPanel({ items, onClose, onOpen }: Props) {
  const photos = items.flatMap((i) => i.photos);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <h2>Photos ({photos.length})</h2>
        {photos.length === 0 ? (
          <div className="empty">No photos yet. Add photos to your items to see them here.</div>
        ) : (
          <div className="photo-grid">
            {photos.map((p, i) => (
              <div key={p.id} className="photo-tile" style={{ cursor: "pointer" }} onClick={() => onOpen(photos, i)}>
                <img src={`${API_URL}${p.url}`} alt={p.caption} />
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
