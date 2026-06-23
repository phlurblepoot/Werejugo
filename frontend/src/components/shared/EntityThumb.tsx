import { API_URL } from "../../api/client";

/** Small square thumb/avatar: the image if available, else the label's initial. */
export function EntityThumb({ thumbUrl, label, size = 36 }: { thumbUrl: string | null; label: string; size?: number }) {
  if (thumbUrl) {
    return (
      <img
        className="entity-thumb"
        src={`${API_URL}${thumbUrl}`}
        alt={label}
        loading="lazy"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span className="entity-thumb entity-thumb-fallback" style={{ width: size, height: size }} aria-hidden="true">
      {(label.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
